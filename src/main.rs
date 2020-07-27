#![feature(proc_macro_hygiene, decl_macro)]

#[macro_use]
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
use std::env::exit;

use rocket::response::{NamedFile};
use rocket_contrib::json::Json;
use once_cell::sync::OnceCell;

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
pub struct NameResponse {
    name: String,
    gender: Gender,
    rank: u32,
    count: u32
}
#[derive(Debug, Serialize)]
struct YearResponse {
    total_births: u32,
    data: Option<NameResponse>,
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

static DATABASE: OnceCell<NameDatabase> = OnceCell::new(None);

#[post("/api/load", format = "application/json", data = "<request>")]
fn name(request: Json<NameRequest>) -> Result<Json<NameResponse>, RequestError> {
    let request: NameRequest = request.into_inner().normalized();
    let database = DATABASE.get().expect("Uninitialized database");
    let mut response = NameResponse {
        years: HashMap::with_capacity(request.years.len()),
        known_names: Vec::new(),
        peak: GenderedData::default(),
        typical_gender: None,
        gender_ratio: None
    };
    let mut peak = GenderedData::<Option<(u32, u32)>> { male: None, female: None };
    let mut totals = GenderedData::<u64>::default();
    let data = database.load_name(&*request.name)?;
    /*
     * TODO: Doesn't restrict to the requested range of years.
     * Even if you're specifically requesting names from the early 20th century
     * it'll include all the modern names made up in the 21st century.
     *
     * Maybe we should consider removing the ability to request certian years
     * and just dump all the data related to the name.
     * 
     * I'm also considering just adding a second endpoint for "known names".
     * That could be heavily cached, since it's pretty much the same for all users.
     */
    let known_names = database.determine_known_names();
    for &year in &request.years {
        let year_data = 
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
    DatabaseError(heed::Error),
}
impl From<heed::Error> for RequestError {
    #[inline]
    fn from(cause: heed::Error) -> Self {
        RequestError::DatabaseError(cause)
    }
}


fn main() {
    let args = std::env::args().skip(1).collect::<Vec<String>>();
    match args.get(0).map(String::as_str) {
        Some("start-server") => {
            // USAGE: `name-popularity start-server [database_file]`
            let database_path = args.get(1).map(Path::new).unwrap_or_else(|| {
                eprintln!("Please specifiy a database-path to start-server");
                exit(1);
            });
            if !database_path.exists() {
                eprintln!("Database file doesn't exist");
                exit(1);
            }
            match start_server() {
                Ok(()) => {},
                Err(e) => eprintln!("Server failed: {}", e),
            }
        }
        _ => {
            eprintln!("Please specify a valid sub-command");
            exit(1);
        }
    }
}

fn start_server(path: &Path) -> anyhow::Result<()> {
    let database = NameDatabase::new(path.into())?;
    DATABASE.set(database)
        .unwrap_or_else(|| unreachable!("Already initialized database {}", path.display()));
    rocket::ignite().mount("/", routes![index, files, name]).launch();
}
