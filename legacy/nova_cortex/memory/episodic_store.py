"""Optional bounded SQLite/NVMe mirror of numerical replay records."""

from dataclasses import fields
from io import BytesIO
import json
import sqlite3
import numpy as np
from .hippocampus_buffer import Transition


class EpisodicStore:
    def __init__(self, filename, capacity, *, representation):
        self.capacity = capacity
        self.connection = sqlite3.connect(str(filename))
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS context (id INTEGER PRIMARY KEY CHECK(id=1), representation TEXT)"
        )
        previous = self.connection.execute(
            "SELECT representation FROM context WHERE id=1"
        ).fetchone()
        if previous is not None and previous[0] != representation:
            self.connection.close()
            raise ValueError(
                "episodic store belongs to a different starting representation"
            )
        self.connection.execute(
            "INSERT OR IGNORE INTO context VALUES (1,?)", (representation,)
        )
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS episodes (id INTEGER PRIMARY KEY, surprise REAL, scalars TEXT, arrays BLOB)"
        )
        self.connection.commit()

    def append(self, transition, surprise):
        transition.validate()
        arrays, scalars = {}, {}
        for field in fields(transition):
            value = getattr(transition, field.name)
            (arrays if isinstance(value, np.ndarray) else scalars)[field.name] = value
        buffer = BytesIO()
        np.savez(buffer, **arrays)
        with self.connection:
            self.connection.execute(
                "INSERT INTO episodes(surprise,scalars,arrays) VALUES (?,?,?)",
                (
                    float(surprise),
                    json.dumps(scalars, allow_nan=False),
                    buffer.getvalue(),
                ),
            )
            self.connection.execute(
                "DELETE FROM episodes WHERE id NOT IN (SELECT id FROM episodes ORDER BY id DESC LIMIT ?)",
                (self.capacity,),
            )

    def records(self):
        query = self.connection.execute(
            "SELECT surprise,scalars,arrays FROM episodes ORDER BY id"
        )
        for surprise, scalars, arrays in query:
            if len(arrays) > 1024 * 1024:
                raise ValueError("episodic payload too large")
            with np.load(BytesIO(arrays), allow_pickle=False) as source:
                values = {name: source[name] for name in source.files}
            yield Transition(**json.loads(scalars), **values).validate(), surprise

    def close(self):
        self.connection.close()
