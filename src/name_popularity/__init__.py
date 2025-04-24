from ._version import __version__, __version_tuple__
from .gender import Gender, GenderMap


def normalize_name(text: str) -> str:
    """Normalize the name, capitalizing the first letter"""
    return text[0].upper() + text[1:].lower()


__all__ = (
    "normalize_name",
    "__version__",
    "__version_tuple__",
    "Gender",
    "GenderMap",
)
