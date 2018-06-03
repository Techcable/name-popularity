#![feature(plugin, decl_macro)]
#![plugin(rocket_codegen)]

extern crate rocket;
extern crate rocket_contrib;
extern crate serde;
#[macro_use]
extern crate serde_derive;
extern crate name_popularity;
extern crate parking_lot;

use std::io;
use std::path::{Path, PathBuf};
use std::collections::HashMap;

use rocket::response::{NamedFile};
use rocket_contrib::Json;
use parking_lot::Mutex;

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
    location.push("names");
    if location.exists() {
        Ok(location)
    } else {
        Err(RequestError::MissingDatabase)
    }
}
static DATABASE: Mutex<Option<NameDatabase>> = Mutex::new(None);

#[post("/api/load", format = "application/json", data = "<request>")]
fn name(request: Json<NameRequest>) -> Result<Json<NameResponse>, RequestError> {
    let request: NameRequest = request.into_inner().normalized();
    let mut lock = DATABASE.lock();
    let database = if lock.is_some() {
        lock.as_mut().unwrap()
    } else {
        *lock = Some(NameDatabase::new(database_location()?).unwrap());
        lock.as_mut().unwrap()
    };
    let mut response = NameResponse {
        years: HashMap::with_capacity(request.years.len()),
        known_names: Vec::new(),
        peak: GenderedData::default(),
        typical_gender: None,
        gender_ratio: None
    };
    let mut peak = GenderedData::<Option<(u32, u32)>> { male: None, female: None };
    let mut totals = GenderedData::<u64>::default();
    for &year in &request.years {
        let data = database.load_year(year)?;
        response.years.insert(year, data.as_ref().map(|gender, data| {
            let total_births = data.total_births();
            let data = data.get(&*request.name).cloned();
            let count = data.as_ref().map_or(0, |data| data.count);
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
            YearResponse { data, total_births, ratio }
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
    response.known_names = database.determine_known_names(&request.years)
        .cloned().collect();
    Ok(Json(response))
}
#[derive(Debug)]
enum RequestError {
    ParseYear(ParseError),
    MissingDatabase,
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
