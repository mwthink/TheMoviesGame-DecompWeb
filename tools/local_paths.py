"""This machine's paths for the Python tools: environment variables, or `local.env` at the repository root (gitignored; see local.env.example).

An environment variable wins over the file. Only the game's own standard folders have defaults; everything else must be set or passed on the
command line.

    from local_paths import game_dir, game_exe, pak_dir, save_dir, star_dir, game_data
"""
import os

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read_local_env():
    out = {}
    path = os.path.join(REPO_ROOT, 'local.env')
    if not os.path.exists(path):
        return out
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            v = v.strip().strip('"')
            out[k.strip()] = os.path.expanduser(v) if v else ''
    return out


_FILE = _read_local_env()


def get(key, default=None):
    v = os.environ.get(key) or _FILE.get(key)
    return v if v else default


def game_dir():
    """The game install (MoviesSE.exe, Data/pak), or None."""
    return get('OTM_GAME_DIR')


def game_exe():
    d = game_dir()
    return os.path.join(d, 'MoviesSE.exe') if d else None


def pak_dir():
    d = game_dir()
    return get('OTM_PAK_DIR', os.path.join(d, 'Data', 'pak') if d else None)


def save_dir():
    return get('OTM_SAVE_DIR', os.path.expanduser(os.path.join('~', 'Documents', 'The Movies', 'Saved Games')))


def star_dir():
    return get('OTM_STAR_DIR', os.path.expanduser(os.path.join('~', 'Documents', 'The Movies', 'StarMaker')))


def game_data():
    """Extracted game files (tools/pak_extract.py writes them here)."""
    return get('OTM_GAME_DATA', os.path.join(REPO_ROOT, 'data', 'game_data'))
