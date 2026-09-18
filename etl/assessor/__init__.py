"""Assessor leg: Jefferson Parish (jpassessor.net) and Orleans Parish (nolaassessor.com)."""

from .jefferson import JeffersonAdapter
from .orleans import OrleansAdapter

ADAPTERS = {"jefferson": JeffersonAdapter, "orleans": OrleansAdapter}

__all__ = ["ADAPTERS", "JeffersonAdapter", "OrleansAdapter"]
