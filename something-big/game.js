// Something Big v2 — multiplayer prototype
// Core: Firebase Realtime Database sync, turn order, DIG / BID / EXHIBIT flow.
// Scope: MVP to playtest flow; end-game scoring & full Predator/Haven detail are stubbed.

// ---------- GAME CONSTANTS ----------
const SIZES = ["tiny","small","big","huge","giant"];
const SIZE_LABEL = {tiny:"Tiny", small:"Small", big:"Big", huge:"Huge", giant:"Giant"};
const SIZE_ORDER = {tiny:0, small:1, big:2, huge:3, giant:4};
const ERA = ["Invertebrates","Dinosaurs","Mammals"];
const START_HAND = 3; // each player gets 3 tiny cards
const COLORS = ["#6fd3ff","#a1ff6f","#ffb86f","#ff6f8e","#d96fff","#fff76f","#6fffe0","#6fa8ff","#ffa1e6","#6fff8a"];

// ---------- FIREBASE CONFIG (replace if needed) ----------
const firebaseConfig = {
  apiKey: "AIzaSyA_IpwutILkvxMWV854kxs_jWPChOI4V7A",
  authDomain: "gpttest-42af5.firebaseapp.com",
  databaseURL: "https://gpttest-42af5-default-rtdb.firebaseio.com",
  projectId: "gpttest-42af5",
  storageBucket: "gpttest-42af5.firebasestorage.app",
  messagingSenderId: "62825280437",
  appId: "1:62825280437:web:85532acd64cc6205bc5ffc",
  measurementId: "G-W1SCLXNZZ1"
};

let app, db;
try {
  app = firebase.initializeApp(firebaseConfig);
  db = firebase.database();
  document.getElementById('conn').textContent = 'online';
} catch(e) {
  document.getElementById('conn').textContent = 'offline';
}

// ---------- UI ELEMENTS ----------
const els = {
  name: document.getElementById('name'),
  room: document.getElementById('room'),
  join: document.getElementById('join'),
  piles: document.getElementById('piles'),
  auctions: document.getElementById('auctions'),
  hand: document.getElementById('hand'),
  players: document.getElementById('players'),
  dig: document.getElementById('action-dig'),
  bid: document.getElementById('action-bid'),
  exhibit: document.getElementById('action-exhibit'),
  turnBox: document.getElementById('turnBox'),
  modal: document.getElementById('modal'),
  modalBody: document.getElementById('modal-body'),
  modalActions: document.getElementById('modal-actions'),
};

// ---------- LOCAL STATE ----------
const myId = crypto.randomUUID().slice(0, 8);
const myColor = COLORS[Math.floor(Math.random()*COLORS.length)];
let joined = false;
let roomRef, stateRef, playersRef;
let unsub = [];

// ---------- ROOM JOIN ----------
els.join.addEventListener('click', async () => {
  if (!db) return;
  const name = (els.name.value || '').trim().slice(0,16) || ('Player-'+myId);
  const room = (els.room.value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,20) || 'museum';
  roomRef = db.ref('sbv2/'+room);
  stateRef = roomRef.child('state');
  playersRef = roomRef.child('players');

  // init room if not exists
  const snap = await roomRef.get();
  if (!snap.exists()) {
    await initRoom(roomRef);
  }

  // add player
  const me = { id: myId, name, color: myColor, ts: Date.now(), hand: [], peekedOnce:false };
  await playersRef.child(myId).set(me);
  playersRef.child(myId).onDisconnect().remove();
  joined = true;

  // listeners
  playersRef.on('value', s => renderPlayers(s.val()||{}));
  stateRef.on('value', s => renderState(s.val()));

  // ensure I have starting hand if not already dealt
  await ensureDealt(roomRef, myId);
});

async function initRoom(roomRef){
  const decks = makeDecks();
  // top of each auction starts with one Tiny face-up
  const auctions = { tiny:[], small:[], big:[], huge:[], giant:[] };
  auctions.tiny.push(drawTop(decks.tiny));

  const state = {
    decks,
    auctions,
    extinct: { tiny:false, small:false, big:false, huge:false, giant:false },
    order: [], // player ids
    turn: 0,
    phase: 'lobby', // lobby | action | exhibit
    log: ["Room created"]
  };
  await roomRef.child('state').set(state);
  await roomRef.child('players').set({});
}

function makeDecks(){
  // Build decks per size with a mix of normal/prey/predator/haven/extinction
  const decks = {};
  for (const sz of SIZES){
    const cards = [];
    // add 1 extinction in all except tiniest
    const countNormal = sz==='tiny' ? 24 : 18;
    for (let i=0;i<countNormal;i++){
      cards.push(makeCard('normal', sz));
    }
    if (sz!=='tiny') cards.push({type:'extinction', size:sz, id:cid(), title:`Extinction (${SIZE_LABEL[sz]})`});
    // sprinkle some predators & havens
    for (let i=0;i< (sz==='tiny'?1:2); i++){
      cards.push(makeCard('predator', sz));
      cards.push(makeCard('haven', sz));
    }
    shuffle(cards);
    decks[sz] = cards;
  }
  return decks;
}

function makeCard(type, size){
  const id = cid();
  const era = ERA[Math.floor(Math.random()*ERA.length)];
  if (type==='predator'){
    return { id, type, size, era, title:`${era} Predator`, prey: null, preyMax: SIZES[Math.max(0, SIZE_ORDER[size]-1)] || 'tiny' };
  } else if (type==='haven'){
    // simple haven with one slot up to size
    return { id, type, size, era, title:`${era} Haven`, slots:[null], slotMax:size };
  } else {
    return { id, type:'normal', size, era, title:`${era} Fossil` };
  }
}

function cid(){ return Math.random().toString(36).slice(2,9) }
function shuffle(a){ for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]] } }
function drawTop(deck){ return deck && deck.length ? deck.pop() : null }

async function ensureDealt(roomRef, pid){
  const st = (await stateRef.get()).val();
  const players = (await playersRef.get()).val()||{};
  const me = players[pid];
  // Add to turn order if missing
  if (!st.order.includes(pid)){
    st.order.push(pid);
  }
  // Deal 3 tiny cards if empty
  if (!me.hand || me.hand.length===0){
    me.hand = [];
    for (let i=0;i<START_HAND;i++){
      const card = drawTop(st.decks.tiny);
      if (card) me.hand.push(faceDown(card));
    }
    await playersRef.child(pid).set(me);
  }
  // start game if in lobby and at least 1 player
  if (st.phase==='lobby' && st.order.length>0){
    st.phase='action';
    st.turn=0;
    st.log.push('Game started');
  }
  await stateRef.set(st);
}

// ---------- RENDER ----------
function renderPlayers(players){
  const box = els.players;
  box.innerHTML='';
  const stTurn = currentTurnIndexCache;
  const order = stateCache?.order||[];
  for (const pid of Object.keys(players)){
    const p = players[pid];
    const row = document.createElement('div');
    row.className='player';
    const dot = document.createElement('div');
    dot.className='dot';
    dot.style.background = p.color||'#888';
    const name = document.createElement('div');
    name.textContent = p.name + (order[stTurn]===pid ? ' • (turn)' : '');
    row.append(dot, name);
    box.appendChild(row);
  }
  // render my hand
  renderHand(players[myId]?.hand||[]);
}

function cardView(c){
  const d = document.createElement('div');
  d.className = 'card';
  if (c.faceDown) d.classList.add('face-down');
  const h3 = document.createElement('div');
  h3.innerHTML = `<strong>${c.faceDown ? 'Face-down' : c.title}</strong>`;
  const meta = document.createElement('div');
  meta.className='meta';
  meta.innerHTML = `<span>${SIZE_LABEL[c.size]}</span><span>${c.faceDown?'?':c.era}</span>`;
  d.append(h3, meta);
  return d;
}

function renderHand(hand){
  els.hand.innerHTML='';
  hand.forEach((c,idx)=>{
    const v = cardView(c);
    v.addEventListener('click', ()=> onHandClick(idx));
    els.hand.appendChild(v);
  });
}

let stateCache=null;
let currentTurnIndexCache=0;

function renderState(st){
  if (!st){ return }
  stateCache = st;
  currentTurnIndexCache = st.turn||0;

  // Piles
  els.piles.innerHTML='';
  for (const sz of SIZES){
    const pile = document.createElement('div');
    pile.className='pile';
    const extinct = st.extinct[sz];
    const count = st.decks[sz]?.length||0;
    const h = document.createElement('h3');
    h.innerHTML = `${SIZE_LABEL[sz]} <span>${extinct?'⛔️ extinct':count+' left'}</span>`;
    pile.appendChild(h);
    const stack = document.createElement('div');
    stack.className='stack';
    const topBack = document.createElement('div');
    topBack.className='card face-down size-'+sz;
    topBack.innerHTML = `<div class="meta"><span>${SIZE_LABEL[sz]}</span><span>face-down</span></div>`;
    stack.appendChild(topBack);
    pile.appendChild(stack);
    pile.addEventListener('click', ()=> attemptDig(sz));
    if (extinct) pile.style.opacity = 0.5;
    els.piles.appendChild(pile);
  }

  // Auctions
  els.auctions.innerHTML='';
  for (const sz of SIZES){
    const a = document.createElement('div');
    a.className='auction';
    const arr = st.auctions[sz]||[];
    const top = arr.length ? arr[arr.length-1] : null;
    const h = document.createElement('h3');
    h.innerHTML = `${SIZE_LABEL[sz]} <span>${arr.length} card(s)</span>`;
    a.appendChild(h);
    const stack = document.createElement('div');
    stack.className='stack';
    if (top){
      stack.appendChild(cardView(top));
    } else {
      const empty = document.createElement('div');
      empty.className='card';
      empty.innerHTML = `<em>Empty</em>`;
      stack.appendChild(empty);
    }
    a.appendChild(stack);
    a.addEventListener('click', ()=> attemptBid(sz));
    els.auctions.appendChild(a);
  }

  // Turn box + action buttons
  const myTurn = st.order[st.turn] === myId;
  els.turnBox.textContent = myTurn ? 'Your turn: DIG or BID, then EXHIBIT.' : 'Waiting for your turn...';
  els.dig.disabled = !myTurn;
  els.bid.disabled = !myTurn;
  els.exhibit.disabled = !myTurn || st.phase!=='exhibit';
}

function faceDown(c){ return {...c, faceDown:true} }
function faceUp(c){ if (!c) return c; const copy = {...c}; delete copy.faceDown; return copy; }

// ---------- TURN FLOW ----------
async function advancePhase(next){
  const st = (await stateRef.get()).val();
  st.phase = next;
  await stateRef.set(st);
}

async function advanceTurn(){
  const st = (await stateRef.get()).val();
  st.turn = (st.turn + 1) % Math.max(1, st.order.length);
  st.phase = 'action';
  await stateRef.set(st);
}

// DIG: draw top from face-down pile, peek, then swap with any of your cards or send to auction
async function attemptDig(size){
  const st = (await stateRef.get()).val();
  if (st.order[st.turn] !== myId || st.phase!=='action') return;
  if (st.extinct[size]) return;
  const card = drawTop(st.decks[size]);
  if (!card) return;

  if (card.type==='extinction'){
    // extinguish this pile
    st.extinct[size]=true;
    // place extinction card on top of auction (visible)
    st.auctions[size].push(faceUp(card));
    st.log.push(`Extinction in ${SIZE_LABEL[size]}! Dig closed.`);
    await stateRef.set(st);
    return; // still your action? Keep simple: drawing extinction ends your action.
  }

  // Show modal to choose: swap with which hand index, or discard to auction
  showModal(`<h3>Dig: ${card.title}</h3>
    <div>${SIZE_LABEL[card.size]} • ${card.era}</div>
    <p>Swap with one of your cards, or send to the ${SIZE_LABEL[card.size]} auction.</p>`, [
    ...getMyHand().map((_,idx)=> ({label:`Swap with hand ${idx+1}`, fn: async()=>{
      const players = (await playersRef.get()).val();
      const me = players[myId];
      const old = me.hand[idx];
      me.hand[idx] = faceDown(card); // new card face-down in hand
      st.auctions[old.size].push(faceUp(old)); // reveal swapped to auction
      await playersRef.child(myId).set(me);
      await stateRef.set(st);
      hideModal();
      await advancePhase('exhibit');
    }})),
    {label:`Send to ${SIZE_LABEL[card.size]} auction`, fn: async()=>{
      st.auctions[card.size].push(faceUp(card));
      await stateRef.set(st);
      hideModal();
      await advancePhase('exhibit');
    }},
    {label:'Cancel', cls:'danger', fn: async()=>{
      // put it back on top (undo)
      st.decks[size].push(card);
      await stateRef.set(st);
      hideModal();
    }}
  ]);
}

// BID: take from any auction (top card), either swap with hand or place in a haven slot that fits
async function attemptBid(size){
  const st = (await stateRef.get()).val();
  if (st.order[st.turn] !== myId || st.phase!=='action') return;
  const pile = st.auctions[size]||[];
  const card = pile[pile.length-1];
  if (!card) return;

  // detect if I have any Haven slots that can take this size
  const myHand = getMyHand();
  const havenOptions = [];
  myHand.forEach((c,idx)=>{
    if (!c.faceDown && c.type==='haven'){
      const slotIdx = c.slots.findIndex(s=>s===null);
      if (slotIdx>=0 && SIZE_ORDER[size] <= SIZE_ORDER[c.slotMax]){
        havenOptions.push({handIdx: idx, slotIdx});
      }
    }
  });

  const actions = [
    ...myHand.map((_,idx)=> ({label:`Swap with hand ${idx+1}`, fn: async()=>{
      const players = (await playersRef.get()).val();
      const me = players[myId];
      const old = me.hand[idx];
      me.hand[idx] = faceDown(card);
      st.auctions[size].pop(); // take from auction
      // swapped card goes to the same auction face-up
      st.auctions[old.size].push(faceUp(old));
      await playersRef.child(myId).set(me);
      await stateRef.set(st);
      hideModal();
      await advancePhase('exhibit');
    }})),
  ];

  if (havenOptions.length){
    havenOptions.forEach(opt=>{
      actions.push({label:`Place into Haven (hand ${opt.handIdx+1} slot ${opt.slotIdx+1})`, fn: async()=>{
        const players = (await playersRef.get()).val();
        const me = players[myId];
        const h = {...faceUp(me.hand[opt.handIdx])};
        if (h.type!=='haven') return;
        h.slots[opt.slotIdx] = faceUp(card);
        me.hand[opt.handIdx] = h;
        st.auctions[size].pop();
        await playersRef.child(myId).set(me);
        await stateRef.set(st);
        hideModal();
        await advancePhase('exhibit');
      }});
    });
  }

  actions.push({label:'Cancel', cls:'danger', fn: hideModal});
  showModal(`<h3>Bid from ${SIZE_LABEL[size]} auction</h3>
    <div>${card.title} • ${SIZE_LABEL[card.size]} • ${card.era}</div>`, actions);
}

// EXHIBIT: flip one of your hand cards face-up (if not already). Triggers Predator ability.
els.exhibit.addEventListener('click', async ()=>{
  const st = (await stateRef.get()).val();
  if (st.order[st.turn] !== myId || st.phase!=='exhibit') return;

  const myHand = getMyHand();
  const choices = myHand.map((c,idx)=> ({
    label: c.faceDown ? `Flip hand ${idx+1}` : `(Already up) ${idx+1}`,
    disabled: !c.faceDown,
    fn: async()=>{
      const players = (await playersRef.get()).val();
      const me = players[myId];
      const up = faceUp(me.hand[idx]);
      me.hand[idx] = up;
      await playersRef.child(myId).set(me);
      await stateRef.set(st);
      hideModal();
      // if predator, allow assign prey from auction or another player's plot
      if (up.type==='predator'){ await predatorPrey(up, idx); }
      await advanceTurn();
    }
  }));

  choices.push({label:'Cancel', cls:'danger', fn: hideModal});
  showModal('<h3>Exhibit: choose a card to flip</h3>', choices);
});

async function predatorPrey(predCard, handIdx){
  const st = (await stateRef.get()).val();
  // collect options from auctions (any size <= preyMax)
  const options = [];
  for (const sz of SIZES){
    const top = st.auctions[sz][st.auctions[sz].length-1];
    if (top && SIZE_ORDER[sz] <= SIZE_ORDER[predCard.preyMax]){
      options.push({from:'auction', size:sz, card:top});
    }
  }
  // collect options from other players (any face-up card, size <= preyMax)
  const players = (await playersRef.get()).val();
  Object.entries(players).forEach(([pid,p])=>{
    if (pid===myId) return;
    (p.hand||[]).forEach((c,idx)=>{
      const up = !c.faceDown;
      if (up && SIZE_ORDER[c.size] <= SIZE_ORDER[predCard.preyMax]){
        options.push({from:'player', pid, handIdx: idx, card:c});
      }
    });
  });

  const actions = options.map(opt=> ({
    label: opt.from==='auction' ? `Prey from ${SIZE_LABEL[opt.size]} auction` : `Prey from ${players[opt.pid].name} (hand ${opt.handIdx+1})`,
    fn: async()=>{
      const playersNow = (await playersRef.get()).val();
      const me = playersNow[myId];
      const predator = {...me.hand[handIdx]};
      if (opt.from==='auction'){
        predator.prey = opt.card;
        st.auctions[opt.card.size].pop();
      } else {
        // take from other player's plot; they must draw from the dig site (tiny) to replace
        const op = playersNow[opt.pid];
        const taken = {...op.hand[opt.handIdx]};
        predator.prey = taken;
        // replace opponent card with a face-down draw from tiny dig site (if any)
        const newCard = drawTop(st.decks.tiny);
        op.hand[opt.handIdx] = newCard ? faceDown(newCard) : null;
        await playersRef.child(opt.pid).set(op);
      }
      me.hand[handIdx] = predator;
      await playersRef.child(myId).set(me);
      await stateRef.set(st);
      hideModal();
    }
  }));

  actions.push({label:'Skip prey', fn: hideModal});
  showModal(`<h3>${predCard.title}: choose prey (≤ ${SIZE_LABEL[predCard.preyMax]})</h3>`, actions);
}

// ---------- HELPERS ----------
function getMyHand(){
  const node = els.players; // unused, but here to mirror structure
  // NOTE: We read from playersRef when we need fresh, but for quick views, cache isn't harmful.
  // For the UI hand, we render from the subscription in renderPlayers.
  return (document._myHandCache)||[];
}
function setMyHandCache(h){ document._myHandCache = h }

// Override renderPlayers to set cache properly
const _origRenderPlayers = renderPlayers;
renderPlayers = function(players){
  setMyHandCache(players[myId]?.hand||[]);
  _origRenderPlayers(players);
}

// ---------- MODAL ----------
function showModal(html, actions){
  els.modalBody.innerHTML = html;
  els.modalActions.innerHTML = '';
  actions.forEach(a=>{
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.cls) b.classList.add(a.cls);
    if (a.disabled){ b.disabled=true; }
    b.addEventListener('click', a.fn);
    els.modalActions.appendChild(b);
  });
  els.modal.classList.remove('hidden');
}
function hideModal(){ els.modal.classList.add('hidden') }

// Buttons also allow clicking areas
els.dig.addEventListener('click', ()=>{}); // instruction: click a pile
els.bid.addEventListener('click', ()=>{}); // instruction: click an auction

// Initial tips
if (!db){
  document.getElementById('turnBox').textContent = 'Firebase offline. Add config in game.js.';
}
