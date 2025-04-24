from __future__ import annotations

from collections.abc import Callable
from enum import Enum
from typing import Iterator, MutableMapping, final


class Gender(Enum):
    MALE = "male"
    FEMALE = "female"

    def __repr__(self) -> str:
        return f"Gender.{self.name}"

    def __str__(self) -> str:
        return self.value

    @property
    def short(self) -> str:
        return self.value[0]

    @staticmethod
    def from_short(short: str, /) -> Gender:
        match short.lower():
            case "m":
                return Gender.MALE
            case "f":
                return Gender.FEMALE
            case _:
                raise ValueError(f"Unknown gender shorthand {short!r}")


@final
class GenderMap[T](MutableMapping[Gender, T]):
    """A map keyed are genders"""

    __match_args__ = ("male", "female")
    __slots__ = ("male", "female")
    male: T
    female: T

    def __init__(self, male: T, female: T, /) -> None:
        self.male = male
        self.female = female

    def __getitem__(self, key: Gender, /) -> T:
        match key:
            case Gender.MALE:
                return self.male
            case Gender.FEMALE:
                return self.female
            case _:
                raise KeyError(key)

    def __len__(self) -> int:
        return 2

    def __iter__(self) -> Iterator[Gender]:
        yield Gender.MALE
        yield Gender.FEMALE

    def __setitem__(self, key: Gender, value: T, /) -> None:
        match key:
            case Gender.MALE:
                self.male = value
            case Gender.FEMALE:
                self.female = value
            case _:
                raise TypeError(f"Unsupported key {key!r}")

    def __delitem__(self, key: Gender) -> None:
        raise NotImplementedError

    def sum(self) -> T:
        """Add together the items in the map"""
        return self.male + self.female  # type: ignore

    def map_values[U](self, func: Callable[[T], U], /) -> GenderMap[U]:
        """Apply a transformation to the elements of the map"""
        return self.map_items(lambda _key, value: func(value))

    def map_items[U](self, func: Callable[[Gender, T], U], /) -> GenderMap[U]:
        return GenderMap(
            func(Gender.MALE, self.male),
            func(Gender.FEMALE, self.female),
        )
