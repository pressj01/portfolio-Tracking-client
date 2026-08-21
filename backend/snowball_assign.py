"""One helper for Snowball slash-label category assignment.

Labels such as ``GROWTH / Growth-Stocks`` always become:
  * parent category GROWTH
  * subcategory Growth-Stocks nested under that parent
  * ticker_categories.subcategory_id pointing at the child

A label without a slash, such as ``CASH``, is a top-level category with no
subcategory. Used by both the Snowball categories file and the holdings file.
"""
from __future__ import annotations


def parse_snowball_category_label(value):
    """Split a Snowball label into a top-level category and optional subcategory.

    ``GROWTH / Growth-Stocks`` is category ``GROWTH`` with subcategory
    ``Growth-Stocks``. A label without a slash, such as ``CASH``, is a
    top-level category with no subcategory.
    """
    label = str(value or "").strip()
    if not label:
        return "", ""
    parent, separator, child = label.partition("/")
    parent = parent.strip()
    child = child.strip()
    if separator and child:
        return parent, child
    return parent, ""


def _row_value(row, key, index=0):
    if row is None:
        return None
    if isinstance(row, dict) or hasattr(row, "keys"):
        try:
            return row[key]
        except Exception:
            pass
    return row[index]


def ensure_snowball_category(conn, profile_id, parent_name, subcategory_name=""):
    """Create the parent (and optional child) if missing.

    Returns (category_id, subcategory_id, stats).
    """
    stats = {
        "category_created": False,
        "subcategory_created": False,
    }
    parent_name = str(parent_name or "").strip()
    subcategory_name = str(subcategory_name or "").strip()
    if not parent_name:
        return None, None, stats

    existing = conn.execute(
        """SELECT id FROM categories
           WHERE profile_id = ? AND LOWER(TRIM(name)) = LOWER(?)
           ORDER BY id LIMIT 1""",
        (profile_id, parent_name),
    ).fetchone()
    if existing:
        category_id = _row_value(existing, "id", 0)
    else:
        max_pos = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM categories WHERE profile_id = ?",
            (profile_id,),
        ).fetchone()
        max_sort = _row_value(max_pos, "max_sort", 0)
        next_sort = int(-1 if max_sort is None else max_sort) + 1
        cur = conn.execute(
            "INSERT INTO categories (name, target_pct, sort_order, profile_id) VALUES (?, 0, ?, ?)",
            (parent_name, next_sort, profile_id),
        )
        category_id = cur.lastrowid
        stats["category_created"] = True

    subcategory_id = None
    if subcategory_name:
        existing_sub = conn.execute(
            """SELECT id FROM subcategories
               WHERE category_id = ? AND profile_id = ?
                 AND LOWER(TRIM(name)) = LOWER(?)
               ORDER BY id LIMIT 1""",
            (category_id, profile_id, subcategory_name),
        ).fetchone()
        if existing_sub:
            subcategory_id = _row_value(existing_sub, "id", 0)
        else:
            max_sub = conn.execute(
                """SELECT COALESCE(MAX(sort_order), -1) AS n
                   FROM subcategories
                   WHERE category_id = ? AND profile_id = ?""",
                (category_id, profile_id),
            ).fetchone()
            max_sub_sort = _row_value(max_sub, "n", 0)
            next_sub_sort = int(-1 if max_sub_sort is None else max_sub_sort) + 1
            cur = conn.execute(
                """INSERT INTO subcategories
                   (category_id, name, target_pct, profile_id, sort_order)
                   VALUES (?, ?, 0, ?, ?)""",
                (category_id, subcategory_name, profile_id, next_sub_sort),
            )
            subcategory_id = cur.lastrowid
            stats["subcategory_created"] = True

    return category_id, subcategory_id, stats


def apply_snowball_assignment(
    conn,
    profile_id,
    ticker,
    label,
    preserve_existing_assignment=False,
):
    """Ensure the slash-label tree exists and assign the ticker to it.

    Returns a stats dict compatible with holdings import:
    category_created, subcategory_created, assignment_added, assignment_preserved.
    """
    parent_name, subcategory_name = parse_snowball_category_label(label)
    category_id, subcategory_id, stats = ensure_snowball_category(
        conn, profile_id, parent_name, subcategory_name
    )
    stats.setdefault("assignment_added", False)
    stats.setdefault("assignment_preserved", False)
    ticker = (ticker or "").strip().upper()
    if not ticker or category_id is None:
        return stats

    existing = conn.execute(
        """SELECT category_id, subcategory_id
           FROM ticker_categories
           WHERE ticker = ? AND profile_id = ?""",
        (ticker, profile_id),
    ).fetchone()
    if existing:
        existing_category_id = _row_value(existing, "category_id", 0)
        existing_subcategory_id = _row_value(existing, "subcategory_id", 1)
        same_parent = existing_category_id == category_id
        missing_child = (
            same_parent
            and subcategory_id is not None
            and existing_subcategory_id is None
        )
        if preserve_existing_assignment and not missing_child:
            stats["assignment_preserved"] = True
            return stats
        if same_parent and existing_subcategory_id == subcategory_id:
            stats["assignment_preserved"] = bool(preserve_existing_assignment)
            return stats
        if missing_child:
            conn.execute(
                """UPDATE ticker_categories
                   SET subcategory_id = ?
                   WHERE ticker = ? AND profile_id = ?""",
                (subcategory_id, ticker, profile_id),
            )
            stats["assignment_added"] = True
            return stats
        if preserve_existing_assignment:
            stats["assignment_preserved"] = True
            return stats

    conn.execute(
        "DELETE FROM ticker_categories WHERE ticker = ? AND profile_id = ?",
        (ticker, profile_id),
    )
    conn.execute(
        """INSERT INTO ticker_categories
           (ticker, category_id, subcategory_id, profile_id)
           VALUES (?, ?, ?, ?)""",
        (ticker, category_id, subcategory_id, profile_id),
    )
    stats["assignment_added"] = True
    return stats
