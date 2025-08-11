# Something Big v2 — Multiplayer Prototype (HTML + Firebase)

This repo is a starter to playtest the **Something Big v2** card game online. It uses a single static page + Firebase Realtime Database (no custom server).

## Game (prototype) rules implemented
- Five sizes: Tiny, Small, Big, Huge, Giant
- Shuffle/stack piles by size; one **Tiny** card starts the Tiny **Auction** (face-up discard)
- Each player gets **three Tiny cards**, face-down (you can roleplay the “peek one once” rule for now; we can enforce later)
- **Turn flow:** Action (**DIG** from a pile _or_ **BID** from an auction), then **EXHIBIT** (flip) one card in your plot
- **Predator** (on flip): may take the top card from an auction (≤ prey size) or a face-up card from another player. If you steal from a player, they draw a Tiny face-down as a replacement
- **Haven**: has an empty slot that can hold a card up to the Haven’s size (via **BID** action)
- **Extinction Event**: one per pile (except Tiny). When drawn on DIG, that pile becomes **extinct** (no more digging). The Extinction card is placed on its auction

> Scoring and era bonuses are **not implemented** yet — we’ll add them after playtesting the flow.

## Quick start (local)
1. Ensure you have a Firebase project and Realtime Database enabled in **test mode** (dev only).
2. Open `game.js` and confirm the `firebaseConfig` matches your project.
3. Serve locally (VS Code Live Server or any static server) and share the URL on the same network, or deploy (below).

## Deploy to GitHub Pages
1. Create a new repo (public).
2. Add files and push:
   ```bash
   git init
   git add .
   git commit -m "Initial SBv2 prototype"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Source = Deploy from a branch → main / (root)**.
4. Your site will be live at: `https://<you>.github.io/<repo>/`

## Firebase Rules (development-friendly)
Use test mode to start. When you want minimal structure, try:
```json
{
  "rules": {
    "sbv2": {
      "$room": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```
We can lock these down later (per-room rate limits, only valid moves, etc.).

## Roadmap (I’ll help you iterate)
- [ ] Enforce “peek one Tiny card once” at game start
- [ ] Per-turn **EXHIBIT** requirement (currently enforced via phase)
- [ ] Haven multi-slots by size; era-matching bonuses
- [ ] End-game trigger & scoring (including flipping face-down prey at end)
- [ ] UI polish for clearer instructions and action affordances
- [ ] Optional Firebase Auth if we need identity beyond room/name
