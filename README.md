name-popularity
================
An app to test whether your name is 'usual' or 'unusual'
based on social security birth data.

This is for my little brother since he has a crazy obsession with names.
He keeps asking these crazy questions about 
the names and I had to write this app so we can accurately answer him.

## Source
This is based on the [Social Security Administration's Birth Statistics](https://www.ssa.gov/oact/babynames/limits.html). The data is in a zipfile under the "National Data" link, or available at <https://www.ssa.gov/oact/babynames/names.zip> (~7MiB).

Each year's data is stored in a CSV file inside the zipfile with columns 'name,gender,count'.
 
I use `scripts/convert_database.py` to convert the zipfile into a SQLite database ahead of time. The application never writes to the database.

*NOTE*: The zipfile is also available through the Internet Archive.

## License
This project is licensed under the [Blue Oak Model License](https://blueoakcouncil.org/license/1.0.0).
By contributing to this project, you agree to license your contribution under the same terms.
