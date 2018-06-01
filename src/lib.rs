use std::{iter, slice};
use std::io::{self, BufReader, BufRead};
use std::fmt::{self, Display, Formatter};
use std::fs::File;
use std::hash::Hash;
use std::str::FromStr;
use std::path::{PathBuf};
use std::borrow::Borrow;
use std::cell::RefCell;
use std::collections::{HashSet, HashMap};
use std::collections::hash_map::Entry;

extern crate serde;
#[macro_use]
extern crate serde_derive;

const KNOWN_NAMES_CACHE_LIMIT: usize = 5;

pub struct NameDatabase {
    location: PathBuf,
    years: HashMap<u32, GenderedData<YearData>>,
    known_names: HashSet<String>,
    known_names_cache: Vec<(Vec<u32>, Vec<String>)>
}
impl NameDatabase {
    #[inline]
    pub fn new(location: PathBuf) -> Result<NameDatabase, io::Error> {
        if location.exists() {
            Ok(NameDatabase { location, years: HashMap::new(), known_names: HashSet::new(), known_names_cache: Vec::with_capacity(KNOWN_NAMES_CACHE_LIMIT) })
        } else {
            Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("Missing name database: {}", location.display())
            ))
        }
    }
    pub fn load_year(&mut self, year: u32) -> Result<&GenderedData<YearData>, ParseError> {
        Ok(match self.years.entry(year) {
            Entry::Occupied(entry) => {
                &*entry.into_mut()
            },
            Entry::Vacant(entry) => {
                let file = File::open(self.location.join(format!("yob{}.txt", year)))
                    .map_err(|cause| ParseError { kind: cause.into(), year })?;
                let year = parse_year(BufReader::new(file))
                    .map_err(|kind| ParseError { kind, year })?;
                self.known_names.extend(year.male.name_list.iter()
                    .map(|data| &data.name).cloned());
                self.known_names.extend(year.female.name_list.iter()
                    .map(|data| &data.name).cloned());
                &*entry.insert(year)
            }
        })
    }
    fn find_existing_known_names(&self, years: &[u32]) -> Option<slice::Iter<String>> {
        self.known_names_cache.iter().find(|&(ref existing_years, _)| **existing_years == *years).map(|&(_, ref data)| data.iter())
    }
    pub fn determine_known_names(&mut self, years: &[u32]) -> slice::Iter<String> {
        if self.find_existing_known_names(years).is_some() {
            return self.find_existing_known_names(years).unwrap();
        }
        let data = self.known_names.iter().cloned()
            .filter(|name| years.iter().any(|&year| {
                let year = &self.years[&year];
                year.male.get(&**name).is_some() || year.female.get(&**name).is_some()
            }))
            .collect::<Vec<String>>();
        // Remove LRU
        while self.known_names_cache.len() >= KNOWN_NAMES_CACHE_LIMIT {
            self.known_names_cache.remove(0);
        }
        self.known_names_cache.push((years.to_owned(), data));
        self.known_names_cache.last().unwrap().1.iter()
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
impl Gender {
    #[inline]
    fn parse(c: char) -> Option<Gender> {
        match c {
            'M' => Some(Gender::Male),
            'F' => Some(Gender::Female),
            _ => None
        }
    }
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
    pub fn iter<'a>(&'a self) -> impl Iterator<Item=(Gender, &'a T)> + 'a {
        iter::once((Gender::Male, &self.male))
            .chain(iter::once((Gender::Female, &self.female)))
    }
    #[inline]
    pub fn values<'a>(&'a self) -> impl Iterator<Item=&'a T> + 'a {
        self.iter().map(|(_, value)| value)
    }
    #[inline]
    pub fn map<U, F: FnMut(T) -> U>(self, mut func: F) -> GenderedData<U> {
        GenderedData {
            male: func(self.male),
            female: func(self.female)
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NameData {
    pub name: String,
    pub gender: Gender,
    pub rank: u32,
    pub count: u32
}
pub struct YearData {
    #[allow(dead_code)]
    name_list: Vec<NameData>,
    name_table: HashMap<String, NameData>,
}
impl YearData {
    pub fn new(name_list: Vec<NameData>) -> YearData {
        if cfg!(debug_assertions) {
            for (rank, name) in name_list.iter().enumerate() {
                assert_eq!(name.rank as usize, rank);
            }
        }
        let mut gender = None;
        let mut name_table = HashMap::with_capacity(name_list.len());
        for value in &name_list {
            let expected_gender = *gender.get_or_insert(value.gender);
            debug_assert_eq!(expected_gender, value.gender);
            match name_table.entry(value.name.clone()) {
                Entry::Occupied(entry) => {
                    panic!(
                        "Conflicting entries for {:?}: {:?} and {:?}",
                        value.name, value, entry.get()
                    );
                },
                Entry::Vacant(entry) => {
                    entry.insert(value.clone());
                }
            }
        }
        YearData { name_table, name_list }
    }
    #[inline]
    pub fn get<T: Eq + Hash>(&self, name: T) -> Option<&NameData> where T: Borrow<str> {
        self.name_table.get(name.borrow())
    }
}
#[inline]
fn unpack3<T, I: IntoIterator<Item=T>>(iter: I) -> Option<[T; 3]> {
    let mut iter = iter.into_iter();
    let array = [iter.next()?, iter.next()?, iter.next()?];
    if iter.next().is_none() {
        Some(array)
    } else {
        None
    }
}
#[inline]
fn unpack_single<T, I: IntoIterator<Item=T>>(iter: I) -> Option<T> {
    let mut iter = iter.into_iter();
    let value = iter.next()?;
    if iter.next().is_none() {
        Some(value)
    } else {
        None
    }
}
fn parse_line(text: &str) -> Result<NameData, ParseErrorKind> {
    let  invalid_line = || ParseErrorKind::InvalidLine(text.into());
    let [name, gender, count] = unpack3::<&str, _>(text.split(','))
        .ok_or_else(invalid_line)?;
    Ok(NameData {
        name: name.into(),
        gender: unpack_single(gender.chars()).and_then(Gender::parse)
            .ok_or_else(invalid_line)?,
        rank: u32::max_value(),
        count: u32::from_str(count).map_err(|_| invalid_line())?
    })
}
pub fn parse_year<R: BufRead>(mut reader: R) -> Result<GenderedData<YearData>, ParseErrorKind> {
    let mut buffer = String::new();
    let mut name_lists = GenderedData::<Vec<_>>::default();
    loop {
        buffer.clear();
        reader.read_line(&mut buffer)?;
        if buffer.is_empty() {
            break
        }
        let mut data = parse_line(&buffer.trim())?;
        data.rank = name_lists.get(data.gender).len() as u32;
        name_lists.get_mut(data.gender).push(data);
    }
    Ok(name_lists.map(YearData::new))
}
#[derive(Debug)]
pub struct ParseError {
    pub year: u32,
    pub kind: ParseErrorKind
}
impl Display for ParseError {
    fn fmt(&self, f: &mut Formatter) -> Result<(), fmt::Error> {
        write!(f, "Unable to parse year {}", self.year)?;
        match self.kind {
            ParseErrorKind::InvalidLine(ref line) => write!(f, "invalid line {:?}", line),
            ParseErrorKind::IoError(ref cause) => write!(f, "{}", cause),
        }
    }
}

#[derive(Debug)]
pub enum ParseErrorKind {
    InvalidLine(String),
    IoError(io::Error)
}
impl From<io::Error> for ParseErrorKind {
    #[inline]
    fn from(cause: io::Error) -> Self {
        ParseErrorKind::IoError(cause)
    }
}