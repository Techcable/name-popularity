# runs tests and checks
test: _check && check-format
    uv run pytest

check: _check check-format

# Automatically fix detected issues
fix: && format
    -ruff check --fix --fix-only

# Runs development server
dev: _check
    uv run fastapi dev src/name_popularity/app.py

# Runs in production mode
run: _check
    uv run fastapi run src/name_popularity/app.py

# runs all checks except formatting
_check: && mypy
    pnpm exec tsc --pretty
    # lint
    -ruff check

build: _check

# Setup production environment
setup-prod:
    uv sync --no-dev
    pnpm exec tsc

# checks types
mypy:
    uv run mypy --pretty -p name_popularity

# Checks for formatting issues
check-format:
    @# Faster to invoke directly instaed of using uv
    ruff format --check .
    ruff check --select I --output-format concise .

format:
    ruff format .
    ruff check --select 'I' --fix .

