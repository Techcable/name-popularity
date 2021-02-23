use std::iter;
use std::fmt::{self, Display, Formatter};
use std::path::Path;

extern crate serde;
#[macro_use]
extern crate serde_derive;
extern crate itoa;
extern crate sqlite;
extern crate idmap;

use idmap::DirectIdMap;


pub struct NameDatabase {
    connection: sqlite::Connection
}
impl NameDatabase {
    pub fn open(location: &Path) -> Result<NameDatabase, sqlite::Error> {
        let connection = sqlite::Connection::open_with_flags(location, sqlite::OpenFlags::new().set_read_only())?;
        Ok(NameDatabase { connection })
    }
    pub fn load_year_meta(&self, year: u32) -> Result<GenderedData<YearMeta>, ParseError> {
        let mut stmt = self.connection.prepare("SELECT total_males, total_females FROM years WHERE year == ?")?;
        stmt.bind(1, i64::from(year))?; // year == {year}
        match stmt.next()? {
            sqlite::State::Done => return Err(ParseError::MissingResult { year, query_name: "load_year_meta" }),
            sqlite::State::Row => {
                let total_males = stmt.read::<i64>(0)?;
                let total_females = stmt.read::<i64>(1)?;
                match stmt.next()? {
                    sqlite::State::Done => {
                        // Okay -> we had one and only one result
                        Ok(GenderedData {
                            male: YearMeta { total_births: total_males as u32 },
                            female: YearMeta { total_births: total_females as u32 }
                        })
                    },
                    sqlite::State::Row => {
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
        let mut stmt = self.connection.prepare(r#"SELECT name_counts.year, name_counts.male_count,
            name_counts.female_count, male_rank, female_rank FROM name_counts
            INNER JOIN names ON name_counts.name_id == names.id WHERE names.name == ? AND name_counts.year >= ?"#)?;
        stmt.bind(1, name)?;
        stmt.bind(2, i64::from(start_year))?;
        let mut result = DirectIdMap::with_capacity_direct(2020usize.saturating_sub(start_year as usize));
        while let sqlite::State::Row = stmt.next()? {
            let actual_year = stmt.read::<i64>(0)? as u32;
            let male_count = stmt.read::<i64>(1)?;
            let female_count = stmt.read::<i64>(2)?;
            let male_rank = stmt.read::<Option<i64>>(3)?;
            let female_rank = stmt.read::<Option<i64>>(4)?;
            result.insert(actual_year.checked_sub(start_year).unwrap(), GenderedData {
                male: NameData {
                    rank: male_rank.map(|i| i as u32),
                    count: male_count as u32,
                    gender: Gender::Male
                },
                female: NameData {
                    rank: female_rank.map(|i| i as u32),
                    count: female_count as u32,
                    gender: Gender::Female
                }
            });
        }
        Ok(result)
    }
    pub fn determine_known_names(&self, years: &[u32]) -> Result<Vec<String>, ParseError> { 
        /*
         * TODO: Remove this horribleness
         *
         * Probably should just stop allowing filtering by 'years'.
         *
         * We don't use the prepared statement API here,
         * because we are dynamically building the query at runtime.
         */
        let mut query = String::from("SELECT DISTINCT names.name FROM name_counts INNER JOIN names ");
        query.push_str("on name_counts.name_id == names.id WHERE (name_counts.male_count > 0 OR name_counts.female_count > 0)");
        query.push_str("AND name_counts.year in (");
        query.reserve(years.len() * 6);
        // NOTE: This should not be vulnerable to SQL injection since we only use unsigned integers
        for (index, &year) in years.iter().enumerate() {
            if index != 0 {
                query.push_str(", ");
            }
            let mut int_buffer = ::itoa::Buffer::new();
            query.push_str(int_buffer.format(year));
        }
        query.push_str(");");
        let mut stmt = self.connection.prepare(&*query)?;
        let mut results = Vec::new();
        while let sqlite::State::Row = stmt.next()? {
            results.push(stmt.read::<String>(0)?);
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
    SqlError(sqlite::Error),
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
impl From<sqlite::Error> for ParseError {
    #[inline]
    fn from(cause: sqlite::Error) -> Self {
        ParseError::SqlError(cause)
    }
}