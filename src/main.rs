#![feature(proc_macro_hygiene, decl_macro)]

#[macro_use]
extern crate rocket;
extern crate rocket_contrib;
extern crate serde;
#[macro_use]
extern crate serde_derive;
extern crate name_popularity;

use std::io;
use std::path::{Path, PathBuf};
use std::collections::HashMap;

use rocket::response::{NamedFile};
use rocket_contrib::json::Json;

use name_popularity::{Gender, normalize_name, NameDatabase, GenderedData, NameData, ParseError};

#[derive(Debug, Deserialize)]
struct NameRequest {
    years: Vec<u32>,
    name: String
}
impl NameRequest {
    #[inline]
    fn normalized(self) -> NameRequest {
        NameRequest {
            years: self.years,
            name: normalize_name(&self.name)
        }
    }
}
#[derive(Debug, Serialize)]
struct YearResponse {
    total_births: u32,
    data: Option<NameData>,
    ratio: f64,
}
#[derive(Debug, Serialize)]
struct NameResponse {
    years: HashMap<u32, GenderedData<YearResponse>>,
    peak: GenderedData<Option<u32>>,
    gender_ratio: Option<f64>,
    typical_gender: Option<Gender>,
    known_names: Vec<String>
}

#[get("/")]
fn index() -> io::Result<NamedFile> {
    NamedFile::open("static/index.html")
}

#[get("/<file..>")]
fn files(file: PathBuf) -> Option<NamedFile> {
    NamedFile::open(Path::new("static/").join(file)).ok()
}

fn database_location() -> Result<PathBuf, RequestError> {
    let mut location = ::std::env::home_dir()
        .ok_or(RequestError::MissingDatabase)?;
    location.push("names.sqlite");
    if location.is_file() {
        Ok(location)
    } else {
        Err(RequestError::MissingDatabase)
    }
}
fn open_database() -> Result<NameDatabase, RequestError> {
    NameDatabase::open(&database_location()?)
        .map_err(|cause| RequestError::InvalidDatabase(cause))
}

#[post("/api/load", format = "application/json", data = "<request>")]
fn name(request: Json<NameRequest>) -> Result<Json<NameResponse>, RequestError> {
    let request: NameRequest = request.into_inner().normalized();
    let database = open_database()?;
    let mut response = NameResponse {
        years: HashMap::with_capacity(request.years.len()),
        known_names: Vec::new(),
        peak: GenderedData::default(),
        typical_gender: None,
        gender_ratio: None
    };
    let mut peak = GenderedData::<Option<(u32, u32)>> { male: None, female: None };
    let mut totals = GenderedData::<u64>::default();
    let start_year = request.years.iter().cloned().min().ok_or(RequestError::RequestedZeroYears)?;
    let data_map = database.list_name_data(&*request.name, start_year)?;
    for &year in &request.years {
        let meta = database.load_year_meta(year)?;
        let data = data_map.get(year - start_year).cloned().unwrap_or_default();
        response.years.insert(year, data.as_ref().map(|gender, data| {
            let total_births = meta.male.total_births + meta.female.total_births;
            let count = data.count;
            *totals.get_mut(gender) += count as u64;
            match *peak.get(gender) {
                Some((_, old_peak)) => {
                    if count >= old_peak {
                        peak.insert(gender, Some((year, count)));
                    }
                },
                None => {
                    if count > 0 {
                        peak.insert(gender, Some((year, count)));
                    }
                }
            }
            let ratio = (count as f64) / (total_births as f64);
            YearResponse { data: Some(data.clone()), total_births, ratio }
        }));
    }
    let grand_total = totals.male + totals.female;
    response.typical_gender = if grand_total == 0 {
        None
    } else if totals.male >= totals.female {
        response.gender_ratio = Some((totals.male as f64) / (grand_total as f64));
        Some(Gender::Male)
    } else {
        response.gender_ratio = Some((totals.female as f64) / (grand_total as f64));
        Some(Gender::Female)
    };
    response.peak = peak.map(|_, opt| opt.map(|(year, _)| year));
    response.known_names = database.determine_known_names(&request.years)?;
    Ok(Json(response))
}
#[derive(Debug)]
enum RequestError {
    ParseYear(ParseError),
    MissingDatabase,
    InvalidDatabase(sqlite::Error),
    RequestedZeroYears
}
impl From<ParseError> for RequestError {
    #[inline]
    fn from(cause: ParseError) -> Self {
        RequestError::ParseYear(cause)
    }
}


fn main() {
    rocket::ignite().mount("/", routes![index, files, name]).launch();
}
