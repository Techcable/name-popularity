check: && check-format
    ruff check

# Checks for formatting issues
check-format:
    @# Faster to invoke directly instaed of using uv
    ruff format --check .
    ruff check --select I --output-format concise .

format:
    ruff format .
    ruff check --select 'I' --fix .
