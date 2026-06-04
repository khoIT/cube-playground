#!/usr/bin/env python3
"""Prune view `includes:` entries that don't exist as a member of the referenced
local cube. A Cube view that includes a non-existent member fails to compile;
this reconciles ported views against the actual local cube member sets.

Member set per cube = its dimensions + measures + segments (the `- name:` tokens,
excluding the top-level cube name). Pre-aggregation names are NOT view-includable
and are excluded.

Usage: prune_view_includes.py <cubes_dir> <view_file>
Edits the view file in place; prints each pruned (cube, member).
"""
import re
import sys


def cube_members(path):
    """All includable member names in a cube file (dims+measures+segments)."""
    text = open(path).read()
    names = re.findall(r"^\s+- name:\s*([A-Za-z_][A-Za-z0-9_]*)", text, re.M)
    # first `- name:` at 2-space indent is the cube name itself; drop the
    # shallowest-indent occurrences (cube/view declarations).
    members = set()
    for m in re.finditer(r"^(\s+)- name:\s*([A-Za-z_][A-Za-z0-9_]*)", text, re.M):
        indent = len(m.group(1))
        if indent >= 6:  # dims/measures/segments sit at >=6 spaces; cube name at 2
            members.add(m.group(2))
    return members


def main():
    cubes_dir, view_file = sys.argv[1], sys.argv[2]
    import os
    lines = open(view_file).read().split("\n")
    out, cur_members, pruned = [], None, []
    jp_re = re.compile(r"^\s*-?\s*join_path:\s*([A-Za-z0-9_.]+)")
    inc_item = re.compile(r"^(\s*)-\s+([A-Za-z_][A-Za-z0-9_]*)\s*$")
    in_includes = False
    for ln in lines:
        jp = jp_re.match(ln)
        if jp:
            base = jp.group(1).split(".")[0]
            p = os.path.join(cubes_dir, base + ".yml")
            cur_members = cube_members(p) if os.path.exists(p) else None
            in_includes = False
            out.append(ln)
            continue
        if re.match(r"^\s*includes:\s*$", ln):
            in_includes = True
            out.append(ln)
            continue
        if in_includes and cur_members is not None:
            it = inc_item.match(ln)
            if it:
                member = it.group(2)
                if member not in cur_members:
                    pruned.append((base, member))
                    continue  # drop this include line
            elif ln.strip() and not ln.lstrip().startswith("#"):
                in_includes = False  # left the includes list
        out.append(ln)

    open(view_file, "w").write("\n".join(out))
    for cube, m in pruned:
        print(f"  pruned {cube}.{m}")
    print(f"total pruned: {len(pruned)}")


if __name__ == "__main__":
    main()
