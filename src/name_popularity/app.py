from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator

import sqlalchemy
from fastapi import FastAPI
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
from starlette.staticfiles import StaticFiles
from techcable.orderedset import OrderedSet

from name_popularity import Gender, GenderMap
from name_popularity.database import NameDatabase, NameInfo


class Settings(BaseSettings):
    database_url: str = Field(
        # use sqlite by default
        default="sqlite:///./data/names.sqlite"
    )


settings = Settings()
engine: sqlalchemy.engine.Engine
database: NameDatabase


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    global engine, database
    engine = sqlalchemy.create_engine(settings.database_url)
    database = NameDatabase(engine)
    yield


app = FastAPI(lifespan=lifespan, openapi_url=None)


class KnownYearsResponse(BaseModel):
    # first and last year inclusive
    earliest_year: int
    latest_year: int


@app.get("/api/known_years")
def known_years() -> KnownYearsResponse:
    year_range = database.known_years
    assert year_range.step == 1
    return KnownYearsResponse(
        earliest_year=year_range.start,
        # exclusive -> inclusive
        latest_year=year_range.stop - 1,
    )


@app.get("/api/known_names")
def known_names() -> list[str]:
    return list(database.list_known_names())


class YearGenderResponse(BaseModel):
    total_births: int
    data: NameInfo | None
    ratio: float


class YearResponse(BaseModel):
    # TODO: Get GenderMap to work pydantic?
    male: YearGenderResponse
    female: YearGenderResponse


class PeakYearInfo(BaseModel):
    male: int | None
    female: int | None


class NameResponse(BaseModel):
    years: dict[int, YearResponse]
    peak: PeakYearInfo
    gender_ratio: float | None
    typical_gender: Gender | None


@dataclass
class CurrentPeak:
    year: int
    count: int

    def pick_max(self, other: CurrentPeak | None) -> CurrentPeak:
        if other is None or self.count > other.count:
            return self
        else:
            return other


class NameRequest(BaseModel):
    years: list[int]
    name: str


@app.post("/api/load")
def load_info(request: NameRequest) -> NameResponse:
    # TODO: Error on blank years (it breaks `min`)
    years = OrderedSet(request.years)
    name = request.name
    response_years = {}
    peak: GenderMap[None | CurrentPeak] = GenderMap(None, None)
    totals = GenderMap(0, 0)
    start_year = min(years)
    raw_data = database.resolve_name_info(name, start_year)
    for year in years:
        year_stats = database.load_year_stats(year)
        if year not in raw_data:
            # TODO: Handle missing years (give an error)
            continue

        def _process_raw_info(gender: Gender, raw_info: NameInfo) -> YearGenderResponse:
            total_births = year_stats.male.total_births + year_stats.female.total_births
            totals[gender] += raw_info.count
            peak[gender] = CurrentPeak(year, raw_info.count).pick_max(peak[gender])
            ratio = raw_info.count / total_births
            return YearGenderResponse(
                total_births=total_births,
                data=raw_info,
                ratio=ratio,
            )

        response_years[year] = YearResponse(
            male=_process_raw_info(Gender.MALE, raw_data[year].male),
            female=_process_raw_info(Gender.FEMALE, raw_data[year].female),
        )

    grand_total = totals.sum()
    typical_gender: None | Gender
    if grand_total == 0:
        typical_gender = None
    elif totals.male >= totals.female:
        typical_gender = Gender.MALE
    else:
        typical_gender = Gender.FEMALE
    gender_ratio = (
        totals[typical_gender] / grand_total if typical_gender is not None else None
    )
    return NameResponse(
        years=response_years,
        peak=PeakYearInfo(
            male=peak.male.year if peak.male is not None else None,
            female=peak.female.year if peak.female is not None else None,
        ),
        gender_ratio=gender_ratio,
        typical_gender=typical_gender,
    )


# add static files as last route
app.mount("/", StaticFiles(directory="static", html=True), name="static")
