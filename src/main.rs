#![feature(proc_macro_hygiene, decl_macro)]

#[macro_use]
extern crate rocket;
#[macro_use]
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

#[database("sqlite_names")]
struct NamesDBConnection(rusqlite::Connection);
impl NamesDBConnection {
    #[inline]
    pub fn as_lib(&self) -> NameDatabase<'_> {
        NameDatabase::from_connection(&*self)
    }
}

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
}

#[get("/")]
fn index() -> io::Result<NamedFile> {
    NamedFile::open("static/index.html")
}

#[get("/<file..>")]
fn files(file: PathBuf) -> Option<NamedFile> {
    NamedFile::open(Path::new("static/").join(file)).ok()
}

#[get("/api/known_names", format = "application/json")]
fn known_names(conn: NamesDBConnection) -> Result<Json<Vec<String>>, RequestError> {
    let database = conn.as_lib();
    Ok(Json(database.list_known_names()?))
}

#[post("/api/load", format = "application/json", data = "<request>")]
fn name(database: NamesDBConnection, request: Json<NameRequest>) -> Result<Json<NameResponse>, RequestError> {
    let request: NameRequest = request.into_inner().normalized();
    let database = database.as_lib();
    let mut response = NameResponse {
        years: HashMap::with_capacity(request.years.len()),
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
    Ok(Json(response))
}
#[derive(Debug)]
enum RequestError {
    ParseYear(ParseError),
    RequestedZeroYears
}
impl From<ParseError> for RequestError {
    #[inline]
    fn from(cause: ParseError) -> Self {
        RequestError::ParseYear(cause)
    }
}


fn main() {
    rocket::ignite()
        .attach(NamesDBConnection::fairing())
        .mount("/", routes![index, known_names, files, name]).launch();
}
