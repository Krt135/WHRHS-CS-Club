# Known Issues

## Members can't delete their own games

**Status:** open. This bug predates the September 2026 database rule changes.

**What happens:** a regular member clicks delete on their own solo game on
`projects.html` and gets an error. The game is not removed.

**Why:** `window.deleteGame` in `scriptFolder/projects.js` does a single
multi-path `update()` that:

1. removes `games/{gameId}`, which the rules allow for the game's author, and
2. writes `deleted_posts/{gameId}`, the moderation queue, which only execs and
   admins can write.

Realtime Database applies multi-path updates all-or-nothing, so the denied
`deleted_posts` write rejects the whole update.

**Current behavior:** only execs and admins can delete games, both solo and
group.

**Possible fixes:**
- Allow `deleted_posts/$postId` to be created by the author of the post being
  deleted (`newData.child('_deletedById').val() === auth.uid`), with only execs
  and admins allowed to read, edit or remove entries.
- Or move deletion into a callable Cloud Function that checks ownership and does
  both writes with admin privileges.

## Rules reference

The `games/` rules in `database.rules.json`:
- Anyone can read, whether signed in or not.
- Signed-in users can create, edit or delete their own games when
  `category !== "group"` and `authorUid` is their own uid.
- Execs and admins can create, edit or delete any game. Only they can write
  group games.
