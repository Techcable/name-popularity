use std::{iter, slice};
use std::io::{self, BufReader, BufRead};
use std::fmt::{self, Display, Formatter};
use std::fs::File;
use std::hash::Hash;
use std::str::FromStr;
use std::path::{PathBuf};
use std::borrow::Borrow;
use std::collections::{HashSet, HashMap};
use std::collections::hash_map::Entry;

use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
pub struct NameEntry {
    start_year: u32,
    entries: Vec<GenderedData<YearEntry>>
}
impl NameEntry {
    #[inline]
    pub fn get_by_year(&self, year: u32) -> Option<&GenderedData<YearEntry>> {
        self.entries.get(self.start_year + year)
    }
    #[inline]
    pub fn iter(&self) -> impl Iterator<Item=(u32, &'_ GenderedData<YearEntry>)> + '_ {
        assert_eq!(self.entries.male.len(), self.entries.female.len());
        self.entries.iter().enumerate()
            .map(|(offset, data)| (self.offset + self.start_year, data))
    }
}
#[derive(Copy, Clone)]
pub struct YearEntry {
    /// The number of births this year
    pub num_births: u32,
    /// A list of the (1-indexed) popularity ranking of this name this year, starting at $start_year
    ///
    /// Must have the same length as `num_births`
    pub rank: u32,
}

type DbValue = head::types::SerdeJson<NameEntry>;
pub struct NameDatabase {
    env: head::Env,
    database: head::Database<head::types::Str, DbValue>,
}
impl NameDatabase {
    pub fn new(location: PathBuf) -> Result<NameDatabase, head::Error> {
        let env = head::EnvOptionOptions::new().open(location)?;
        let database = env.create_database(None)?;
        Ok(NamedDatabase { env, database })
    }
    pub fn load_name(&self, name: &str) -> Result<Option<NameEntry>, head::Error> {
        let txn = self.read_txn_typed::<DbValue>()?;
        Ok(self.env.get(&txn, name)?)
    }
    pub fn determine_known_names(&self) -> Result<Vec<&'_ str>, head::Error> {
        let txn = self.read_txn_typed::<DbValue>()?;
        let mut result = Vec::with_capacity(256);
        let mut iter = db.iter(&txn)?;
        for res in iter {
            let (key, _) = res?;
            result.push(key);
        }
        Ok(result)
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

#[deprecated(note = "Legacy text database")]
pub struct YearData {
    #[allow(dead_code)]
    name_list: Vec<NameData>,
    name_table: HashMap<String, NameData>,
    total_births: u32
}
impl YearData {
    pub fn new(name_list: Vec<NameData>) -> YearData {
        if cfg!(debug_assertions) {
            for (rank, name) in name_list.iter().enumerate() {
                assert_eq!(name.rank as usize, rank);
            }
        }
        let mut total_births = 0;
        let mut gender = None;
        let mut name_table = HashMap::with_capacity(name_list.len());
        for value in &name_list {
            let expected_gender = *gender.get_or_insert(value.gender);
            debug_assert_eq!(expected_gender, value.gender);
            total_births += value.count;
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
        YearData { name_table, name_list, total_births }
    }
    #[inline]
    pub fn total_births(&self) -> u32 {
        self.total_births
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
    Ok(name_lists.map(|_, data|YearData::new(data)))
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