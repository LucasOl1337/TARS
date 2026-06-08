from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

import db


class DatabaseRecoveryTest(unittest.TestCase):
    def test_init_db_quarantines_malformed_database_and_seeds_persona(self) -> None:
        original_db_path = db.DB_PATH
        corrupt_bytes = b"not a sqlite database"

        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            tmp_db = Path(tmp) / "tars.db"
            tmp_db.write_bytes(corrupt_bytes)
            db.DB_PATH = tmp_db

            try:
                db.init_db()

                backups = list(Path(tmp).glob("tars.db.corrupt-*.bak"))
                self.assertEqual(len(backups), 1)
                self.assertEqual(backups[0].read_bytes(), corrupt_bytes)

                conn = sqlite3.connect(str(tmp_db))
                try:
                    self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                    row = conn.execute("SELECT slug FROM personas WHERE slug = 'tars'").fetchone()
                    self.assertIsNotNone(row)
                finally:
                    conn.close()
            finally:
                db.DB_PATH = original_db_path


if __name__ == "__main__":
    unittest.main()
