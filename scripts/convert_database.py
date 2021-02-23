import sqlite3
import csv
from pathlib import Path
from collections import defaultdict
import sys
import re
from typing import Optional

def setup_database(conn: sqlite3.Connection):
    conn.executescript("""
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS names(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS years(
        year INTEGER PRIMARY KEY,
        total_males INTEGER NOT NULL,
        total_females INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS name_counts(
        year INTEGER NOT NULL,
        name_id INTEGER NOT NULL,
        male_count INTEGER NOT NULL,
        female_count INTEGER NOT NULL,
        male_rank INTEGER,
        female_rank INTEGER,
        FOREIGN KEY (name_id) REFERENCES names(id),
        FOREIGN KEY (year) REFERENCES years(year)
    );
    """)
#   NOTE: Skip this. It bloats the size of the database (30 MB -> 60 MB)
#   It's not really needed anyways ^_^
#
#    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS name_count_index ON name_counts (year, name_id);")


def init_name(conn: sqlite3.Connection, name: str) -> int:
    cursor = conn.cursor()
    cursor.execute("INSERT OR IGNORE INTO names (name) VALUES (?);", (name,))
    cursor.execute("SELECT names.id FROM names WHERE name == ?;", (name,))
    res = cursor.fetchone()[0]
    if not isinstance(res, int):
        raise TypeError(f"Expected an integer id for {name!r}: {res!r}")
    return res

def insert_name(conn: sqlite3.Connection, name: str, year: int, *, male_count: int, female_count: int, male_rank: Optional[int], female_rank: Optional[int]):
    name_id = init_name(conn, name)
    conn.execute(
        "INSERT INTO name_counts (year, name_id, male_count, female_count, male_rank, female_rank) VALUES (?, ?, ?, ?, ?, ?);",
        (year, name_id, male_count, female_count, male_rank, female_rank)
    )

def load_year_file(conn: sqlite3.Connection, year: int, location: Path):
    with open(location) as f:
        reader = csv.reader(f)
        name_counts = defaultdict(lambda: {'male': 0, 'female': 0})
        for row in reader:
            assert len(row) == 3
            name = row[0]
            gender = row[1]
            count = int(row[2])
            assert count >= 0, f"Invalid count: {count}"
            target_counts = name_counts[name]
            if gender == 'M':
                assert target_counts['male'] == 0
                target_counts['male'] = count
            elif gender == 'F':
                assert target_counts['female'] == 0
                target_counts['female'] = count
            else:
                raise ValueError(f"Unknown gender: {gender!r}")
    total_males = sum(counts['male'] for counts in name_counts.values())
    total_females = sum(counts['female'] for counts in name_counts.values())
    with conn:
        conn.execute("INSERT INTO years (year, total_males, total_females) VALUES (?, ?, ?);", (year, total_males, total_females))
    def rank_names(known_names: set[str], gender: str) -> dict[str, int]:
        return {name: index + 1 for index, name in enumerate(sorted(known_names, key=lambda name: name_counts[name][gender], reverse=True))}
    male_ranks = rank_names(name_counts.keys(), 'male')
    female_ranks = rank_names(name_counts.keys(), 'female')
    # Commit or rollback en masse
    with conn:
        for name, counts in name_counts.items():
            male_count = counts['male']
            female_count = counts['female']
            insert_name(
                conn, name, year, male_count=male_count, female_count=female_count,
                male_rank=male_ranks[name] if male_count > 0 else None,
                female_rank=female_ranks[name] if female_count > 0 else None
            )

_YEAR_FILE_PATTERN = re.compile(r"^yob(\d+)\.txt$")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Invalid number of arguments!", file=sys.stderr)
        print("Usage: ./convert_database.py <database file> <names directory>", file=sys.stderr)
        sys.exit(2)
    database_file = Path(sys.argv[1])
    names_dir = Path(sys.argv[2])
    if not names_dir.is_dir():
        print(f"Invalid names directory: {names_dir}", file=sys.stderr)
        sys.exit(2)
    connection = sqlite3.connect(database_file)
    with connection:
        setup_database(connection)
    for entry in names_dir.iterdir():
        match = _YEAR_FILE_PATTERN.match(entry.name)
        if match is None:
            print(f"Invalid entry in name directory: {entry}", file=sys.stderr)
            sys.exit(1)
        year = int(match[1])
        print(f"Loading year {year}")
        load_year_file(connection, year, entry)
    connection.close()

