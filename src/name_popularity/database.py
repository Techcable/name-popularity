"""Encapsulates database access"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property

import cachebox
from sqlalchemy import Engine, text
from sqlalchemy.exc import NoResultFound
from techcable.orderedset import OrderedSet

from name_popularity import Gender, GenderMap


@dataclass
class YearStats:
    total_births: int

    def __add__(self, other: YearStats) -> YearStats:
        if isinstance(other, YearStats):
            return YearStats(total_births=self.total_births + other.total_births)
        else:
            return NotImplemented


@dataclass(kw_only=True)
class NameInfo:
    gender: Gender
    rank: int | None
    count: int


class NameDatabase:
    engine: Engine
    _cached_known_names: OrderedSet[str] | None

    def __init__(self, engine: Engine) -> None:
        assert isinstance(engine, Engine)
        self.engine = engine
        self._cached_known_names = None

    def list_known_names(self) -> OrderedSet[str]:
        if self._cached_known_names is not None:
            return self._cached_known_names.copy()
        with self.engine.connect() as connection:
            names: OrderedSet[str] = OrderedSet()
            result = connection.execute(
                text("SELECT DISTINCT name FROM names ORDER BY name")
            )
            for name in result.scalars().fetchall():
                assert isinstance(name, str)
                names.add(name)
            self._cached_known_names = names
            return names.copy()

    @cached_property
    def known_years(self) -> range:
        with self.engine.connect() as connection:
            result = connection.execute(text("SELECT MIN(year), MAX(year) from years"))
            earliest, latest = result.one()
            return range(earliest, latest + 1)

    @cachebox.cachedmethod(cachebox.FIFOCache(maxsize=4096))
    def load_year_stats(self, year: int) -> GenderMap[YearStats]:
        with self.engine.connect() as connection:
            result = connection.execute(
                text("SELECT total_males, total_females FROM years WHERE year = :year"),
                {"year": year},
            )
            try:
                male_count, female_count = result.one()
                return GenderMap(int(male_count), int(female_count)).map_values(
                    lambda count: YearStats(count)
                )
            except NoResultFound:
                return GenderMap(YearStats(0), YearStats(0))

    def resolve_name_info(
        self, name: str, start_year: int
    ) -> dict[int, GenderMap[NameInfo]]:
        with self.engine.connect() as connection:
            response = connection.execute(
                text(
                    """SELECT name_counts.year AS year, male_count, female_count,
                    male_rank, female_rank FROM name_counts
                    INNER JOIN names ON name_counts.name_id == names.id 
                    WHERE names.name == :name AND name_counts.year >= :start_year
                    ORDER BY year"""
                ),
                {"name": name, "start_year": start_year},
            )
            result = {}
            for row in response.mappings():
                year = int(row["year"])
                result[year] = GenderMap(
                    NameInfo(
                        gender=Gender.MALE,
                        rank=int(row["male_rank"] or 0),
                        count=int(row["male_count"] or 0),
                    ),
                    NameInfo(
                        gender=Gender.FEMALE,
                        rank=int(row["female_rank"] or 0),
                        count=int(row["female_count"] or 0),
                    ),
                )
            return result
