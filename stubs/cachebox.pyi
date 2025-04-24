from abc import ABCMeta
from collections.abc import Callable
from dataclasses import dataclass

class Cache(metaclass=ABCMeta):
    pass

@dataclass  # hack
class FIFOCache(Cache):
    maxsize: int

def cachedmethod[**P, R](cache: Cache) -> Callable[[Callable[P, R]], Callable[P, R]]:
    pass
