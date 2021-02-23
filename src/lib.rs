use std::iter;
use std::fmt::{self, Display, Formatter};

extern crate serde;
#[macro_use]
extern crate serde_derive;
extern crate rusqlite;
extern crate idmap;

use idmap::DirectIdMap;


pub struct NameDatabase<'a> {
    connection: &'a rusqlite::Connection
}
impl<'a> NameDatabase<'a> {
    pub fn from_connection(connection: &'a rusqlite::Connection) -> Self {
        NameDatabase { connection }
    }
    pub fn load_year_meta(&self, year: u32) -> Result<GenderedData<YearMeta>, ParseError> {
        let mut stmt = self.connection.prepare_cached("SELECT total_males, total_females FROM years WHERE year == ?")?;
        let mut rows = stmt.query(&[&year])?;
        match rows.next().transpose()? {
            None => return Err(ParseError::MissingResult { year, query_name: "load_year_meta" }),
            Some(row) => {
                let total_males: u32 = row.get_checked(0)?;
                let total_females: u32 = row.get_checked(1)?;
                match rows.next().transpose()? {
                    None => {
                        // Okay -> we had one and only one result
                        Ok(GenderedData {
                            male: YearMeta { total_births: total_males },
                            female: YearMeta { total_births: total_females }
                        })
                    },
                    Some(_) => {
                        return Err(ParseError::ExpectedSingleRow {
                            query_name: "load_year_meta",
                            year
                        })
                    }
                }
            }
        }
    }
    pub fn list_name_data(&self, name: &str, start_year: u32) -> Result<DirectIdMap<u32, GenderedData<NameData>>, ParseError> {
        let mut stmt = self.connection.prepare_cached(r#"SELECT name_counts.year, name_counts.male_count,
            name_counts.female_count, male_rank, female_rank FROM name_counts
            INNER JOIN names ON name_counts.name_id == names.id WHERE names.name == ? AND name_counts.year >= ?"#)?;
        let mut rows = stmt.query(&[&name, &start_year])?;
        let mut result = DirectIdMap::with_capacity_direct(2020usize.saturating_sub(start_year as usize));
        while let Some(row) = rows.next().transpose()? {
            let actual_year = row.get_checked::<_, u32>(0)?;
            let male_count = row.get_checked::<_, u32>(1)?;
            let female_count = row.get_checked::<_, u32>(2)?;
            let male_rank = row.get_checked::<_, Option<u32>>(3)?;
            let female_rank = row.get_checked::<_, Option<u32>>(4)?;
            result.insert(actual_year.checked_sub(start_year).unwrap(), GenderedData {
                male: NameData {
                    rank: male_rank,
                    count: male_count,
                    gender: Gender::Male
                },
                female: NameData {
                    rank: female_rank,
                    count: female_count,
                    gender: Gender::Female
                }
            });
        }
        Ok(result)
    }
    pub fn list_known_names(&self) -> Result<Vec<String>, ParseError> { 
        let mut stmt = self.connection.prepare_cached("SELECT name FROM names;")?;
        let mut rows = stmt.query(&[])?;
        let mut results = Vec::new();
        while let Some(row) = rows.next().transpose()? {
            results.push(row.get_checked::<_, String>(0)?);
        }
        Ok(results)
    }
}

pub fn normalize_name(target: &str) -> String {
    let mut original_chars = target.trim().chars();
    let mut result = String::new();
    if let Some(first) = original_chars.next() {
        result.extend(first.to_uppercase());
        for c in original_chars {
            result.extend(c.to_lowercase());
        }
    }
    result
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Gender {
    Male,
    Female
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct GenderedData<T> {
    pub male: T,
    pub female: T
}
impl<T> GenderedData<T> {
    #[inline]
    pub fn get(&self, gender: Gender) -> &T {
        match gender {
            Gender::Male => &self.male,
            Gender::Female => &self.female
        }
    }
    #[inline]
    pub fn get_mut(&mut self, gender: Gender) -> &mut T {
        match gender {
            Gender::Male => &mut self.male,
            Gender::Female => &mut self.female
        }
    }
    #[inline]
    pub fn insert(&mut self, gender: Gender, value: T) {
        *self.get_mut(gender) = value;
    }
    #[inline]
    pub fn iter<'a>(&'a self) -> impl Iterator<Item=(Gender, &'a T)> + 'a {
        iter::once((Gender::Male, &self.male))
            .chain(iter::once((Gender::Female, &self.female)))
    }
    #[inline]
    pub fn values<'a>(&'a self) -> impl Iterator<Item=&'a T> + 'a {
        self.iter().map(|(_, value)| value)
    }
    #[inline]
    pub fn map<U, F: FnMut(Gender, T) -> U>(self, mut func: F) -> GenderedData<U> {
        GenderedData {
            male: func(Gender::Male, self.male),
            female: func(Gender::Female, self.female)
        }
    }
    #[inline]
    pub fn as_ref(&self) -> GenderedData<&T> {
        GenderedData {
            male: &self.male,
            female: &self.female
        }
    }
}
impl Default for GenderedData<NameData> {
    fn default() -> Self {
        GenderedData {
            male: NameData {
                gender: Gender::Male,
                rank: None,
                count: 0
            },
            female: NameData {
                gender: Gender::Female,
                rank: None,
                count: 0
            }
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NameData {
    pub gender: Gender,
    pub rank: Option<u32>,
    pub count: u32
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct YearMeta {
    pub total_births: u32
}
#[derive(Debug)]
pub enum ParseError {
    SqlError(rusqlite::Error),
    ExpectedSingleRow {
        year: u32,
        query_name: &'static str
    },
    MissingResult {
        year: u32,
        query_name: &'static str
    }
}
impl Display for ParseError {
    fn fmt(&self, f: &mut Formatter) -> Result<(), fmt::Error> {
        match *self {
            ParseError::SqlError(ref cause) => write!(f, "SQL Error: {}", cause),
            ParseError::ExpectedSingleRow { year, query_name } => write!(f, "Expected single row for {} in {:?}", year, query_name),
            ParseError::MissingResult { year, query_name } => write!(f, "Missing result for {} in {:?}", year, query_name)
        }
    }
}
impl From<rusqlite::Error> for ParseError {
    #[inline]
    fn from(cause: rusqlite::Error) -> Self {
        ParseError::SqlError(cause)
    }
}