const STRINGS = {
  it: {
    installApp: 'Installa app',
    tasks: 'Compiti', taskLoad: 'Carica {n} pallet sul camion ({d}/{n})', taskUnload: 'Scarica {n} pallet nella zona gialla ({d}/{n})',
    taskNoDrop: 'Non far cadere pallet', taskTime: 'Finisci entro il tempo',
    title1: 'FORKLIFT', title2: 'TYCOON',
    play: 'GIOCA', profile: 'PROFILO', settings: 'IMPOSTAZIONI', login: 'LOGIN', logout: 'Esci',
    back: 'Indietro', close: 'Chiudi', save: 'Salva', cancel: 'Annulla', confirm: 'Conferma',
    coins: 'Monete', level: 'Livello', xp: 'XP',
    contracts: 'Contratti', garage: 'Garage', freeDrive: 'Guida libera', workers: 'Operai', warehouses: 'Magazzini',
    comingSoon: 'Fase 2', language: 'Lingua',
    view: 'Visuale', firstPerson: 'Prima persona', thirdPerson: 'Terza persona',
    sensitivity: 'Sensibilità', steering: 'Sterzo', gyro: 'Giroscopio', wheel: 'Volante', arrows: 'Frecce',
    invertGyro: 'Inverti giroscopio',
    graphics: 'Grafica', low: 'Bassa', high: 'Alta',
    resetProgress: 'Azzera progressi', confirmReset: 'Vuoi davvero cancellare tutti i progressi?',
    easy: 'FACILE', normal: 'NORMALE', hard: 'DIFFICILE',
    load: 'Carico', unload: 'Scarico',
    pallets: 'Pallet', reward: 'Paga', time: 'Tempo', weight: 'Peso', accept: 'ACCETTA',
    contractLevel: 'Contratto liv. {n}', fragile: 'Fragile',
    owned: 'Posseduto', buy: 'Compra', buyFor: 'Compra per {n}', equipped: 'In uso', equip: 'Usa',
    capacity: 'Portata', liftHeight: 'Alzata', speed: 'Velocità',
    notEnoughCoins: 'Monete insufficienti', bought: 'Acquistato!',
    missionComplete: 'CONTRATTO COMPLETATO', missionFailed: 'CONTRATTO FALLITO', timeUp: 'Tempo scaduto',
    drops: 'Pallet caduti', timeBonus: 'Bonus tempo', penalty: 'Penalità', total: 'Totale',
    continue: 'CONTINUA', retry: 'RIPROVA', exitMission: 'Abbandona contratto', pause: 'Pausa', resume: 'Riprendi',
    rotateDevice: 'Ruota il telefono in orizzontale',
    tooHeavy: 'Troppo pesante per questo muletto!', insertDeeper: 'Inserisci di più le forche',
    palletDropped: 'Pallet caduto!', widenForks: 'Allarga le forche: carico instabile',
    objLoad: 'Carica i pallet sul camion', objUnload: 'Scarica i pallet nella zona gialla',
    objFree: 'Esplora il quartiere',
    map: 'Mappa', warehouse: 'Magazzino {n}', forSale: 'In vendita', yourWarehouse: 'Tuo',
    buyWarehouse: 'Comprare il magazzino {n} per {p} monete?',
    playerName: 'Nome', contractsDone: 'Contratti completati', palletsMoved: 'Pallet movimentati',
    totalEarned: 'Monete guadagnate', guest: 'Ospite (non collegato)', linkedAs: 'Collegato: {e}',
    emailPlaceholder: 'la-tua@email.it', sendLink: 'Invia link', linkSent: 'Controlla la tua email per confermare',
    loginInfo: 'Collega un account per non perdere i progressi e giocare su altri dispositivi.',
    cloudOffline: 'Salvataggio solo locale', cloudOk: 'Salvato nel cloud',
    selectWarehouse: 'Magazzino', needCapacity: 'Serve portata {n} kg',
    up: 'Su', down: 'Giù', narrow: 'Stringi', widen: 'Allarga', tiltBack: 'Indietro', tiltFwd: 'Avanti',
    forks: 'Forche', gear: 'Marcia', levelUp: 'Livello {n}!',
    starter: 'Mezzo iniziale', rewardMult: 'Paga x{n}',
  },
  es: {
    installApp: 'Instalar app',
    tasks: 'Tareas', taskLoad: 'Carga {n} palés en el camión ({d}/{n})', taskUnload: 'Descarga {n} palés en la zona amarilla ({d}/{n})',
    taskNoDrop: 'No dejes caer palés', taskTime: 'Termina a tiempo',
    title1: 'FORKLIFT', title2: 'TYCOON',
    play: 'JUGAR', profile: 'PERFIL', settings: 'AJUSTES', login: 'LOGIN', logout: 'Salir',
    back: 'Atrás', close: 'Cerrar', save: 'Guardar', cancel: 'Cancelar', confirm: 'Confirmar',
    coins: 'Monedas', level: 'Nivel', xp: 'XP',
    contracts: 'Contratos', garage: 'Garaje', freeDrive: 'Conducción libre', workers: 'Operarios', warehouses: 'Almacenes',
    comingSoon: 'Fase 2', language: 'Idioma',
    view: 'Vista', firstPerson: 'Primera persona', thirdPerson: 'Tercera persona',
    sensitivity: 'Sensibilidad', steering: 'Dirección', gyro: 'Giroscopio', wheel: 'Volante', arrows: 'Flechas',
    invertGyro: 'Invertir giroscopio',
    graphics: 'Gráficos', low: 'Bajos', high: 'Altos',
    resetProgress: 'Borrar progreso', confirmReset: '¿Seguro que quieres borrar todo el progreso?',
    easy: 'FÁCIL', normal: 'NORMAL', hard: 'DIFÍCIL',
    load: 'Carga', unload: 'Descarga',
    pallets: 'Palés', reward: 'Pago', time: 'Tiempo', weight: 'Peso', accept: 'ACEPTAR',
    contractLevel: 'Contrato niv. {n}', fragile: 'Frágil',
    owned: 'En propiedad', buy: 'Comprar', buyFor: 'Comprar por {n}', equipped: 'En uso', equip: 'Usar',
    capacity: 'Capacidad', liftHeight: 'Elevación', speed: 'Velocidad',
    notEnoughCoins: 'Monedas insuficientes', bought: '¡Comprado!',
    missionComplete: 'CONTRATO COMPLETADO', missionFailed: 'CONTRATO FALLIDO', timeUp: 'Se acabó el tiempo',
    drops: 'Palés caídos', timeBonus: 'Bonus tiempo', penalty: 'Penalización', total: 'Total',
    continue: 'CONTINUAR', retry: 'REINTENTAR', exitMission: 'Abandonar contrato', pause: 'Pausa', resume: 'Reanudar',
    rotateDevice: 'Gira el teléfono en horizontal',
    tooHeavy: '¡Demasiado pesado para esta carretilla!', insertDeeper: 'Mete más las horquillas',
    palletDropped: '¡Palé caído!', widenForks: 'Abre las horquillas: carga inestable',
    objLoad: 'Carga los palés en el camión', objUnload: 'Descarga los palés en la zona amarilla',
    objFree: 'Explora el polígono',
    map: 'Mapa', warehouse: 'Almacén {n}', forSale: 'En venta', yourWarehouse: 'Tuyo',
    buyWarehouse: '¿Comprar el almacén {n} por {p} monedas?',
    playerName: 'Nombre', contractsDone: 'Contratos completados', palletsMoved: 'Palés movidos',
    totalEarned: 'Monedas ganadas', guest: 'Invitado (sin cuenta)', linkedAs: 'Conectado: {e}',
    emailPlaceholder: 'tu@email.es', sendLink: 'Enviar enlace', linkSent: 'Revisa tu email para confirmar',
    loginInfo: 'Vincula una cuenta para no perder el progreso y jugar en otros dispositivos.',
    cloudOffline: 'Guardado solo local', cloudOk: 'Guardado en la nube',
    selectWarehouse: 'Almacén', needCapacity: 'Requiere capacidad {n} kg',
    up: 'Subir', down: 'Bajar', narrow: 'Cerrar', widen: 'Abrir', tiltBack: 'Atrás', tiltFwd: 'Adelante',
    forks: 'Horquillas', gear: 'Marcha', levelUp: '¡Nivel {n}!',
    starter: 'Vehículo inicial', rewardMult: 'Pago x{n}',
  },
  en: {
    installApp: 'Install app',
    tasks: 'Tasks', taskLoad: 'Load {n} pallets onto the truck ({d}/{n})', taskUnload: 'Unload {n} pallets into the yellow zone ({d}/{n})',
    taskNoDrop: 'Do not drop any pallet', taskTime: 'Finish before time runs out',
    title1: 'FORKLIFT', title2: 'TYCOON',
    play: 'PLAY', profile: 'PROFILE', settings: 'SETTINGS', login: 'LOGIN', logout: 'Log out',
    back: 'Back', close: 'Close', save: 'Save', cancel: 'Cancel', confirm: 'Confirm',
    coins: 'Coins', level: 'Level', xp: 'XP',
    contracts: 'Contracts', garage: 'Garage', freeDrive: 'Free drive', workers: 'Workers', warehouses: 'Warehouses',
    comingSoon: 'Phase 2', language: 'Language',
    view: 'Camera', firstPerson: 'First person', thirdPerson: 'Third person',
    sensitivity: 'Sensitivity', steering: 'Steering', gyro: 'Gyroscope', wheel: 'Wheel', arrows: 'Arrows',
    invertGyro: 'Invert gyroscope',
    graphics: 'Graphics', low: 'Low', high: 'High',
    resetProgress: 'Reset progress', confirmReset: 'Do you really want to erase all progress?',
    easy: 'EASY', normal: 'NORMAL', hard: 'HARD',
    load: 'Loading', unload: 'Unloading',
    pallets: 'Pallets', reward: 'Pay', time: 'Time', weight: 'Weight', accept: 'ACCEPT',
    contractLevel: 'Contract lv. {n}', fragile: 'Fragile',
    owned: 'Owned', buy: 'Buy', buyFor: 'Buy for {n}', equipped: 'In use', equip: 'Use',
    capacity: 'Capacity', liftHeight: 'Lift', speed: 'Speed',
    notEnoughCoins: 'Not enough coins', bought: 'Purchased!',
    missionComplete: 'CONTRACT COMPLETE', missionFailed: 'CONTRACT FAILED', timeUp: 'Time is up',
    drops: 'Dropped pallets', timeBonus: 'Time bonus', penalty: 'Penalty', total: 'Total',
    continue: 'CONTINUE', retry: 'RETRY', exitMission: 'Abandon contract', pause: 'Paused', resume: 'Resume',
    rotateDevice: 'Rotate your phone to landscape',
    tooHeavy: 'Too heavy for this forklift!', insertDeeper: 'Push the forks in deeper',
    palletDropped: 'Pallet dropped!', widenForks: 'Widen the forks: unstable load',
    objLoad: 'Load the pallets onto the truck', objUnload: 'Unload the pallets into the yellow zone',
    objFree: 'Explore the district',
    map: 'Map', warehouse: 'Warehouse {n}', forSale: 'For sale', yourWarehouse: 'Yours',
    buyWarehouse: 'Buy warehouse {n} for {p} coins?',
    playerName: 'Name', contractsDone: 'Contracts completed', palletsMoved: 'Pallets moved',
    totalEarned: 'Coins earned', guest: 'Guest (not linked)', linkedAs: 'Linked: {e}',
    emailPlaceholder: 'you@email.com', sendLink: 'Send link', linkSent: 'Check your email to confirm',
    loginInfo: 'Link an account to keep your progress and play on other devices.',
    cloudOffline: 'Local save only', cloudOk: 'Saved to the cloud',
    selectWarehouse: 'Warehouse', needCapacity: 'Needs {n} kg capacity',
    up: 'Up', down: 'Down', narrow: 'Narrow', widen: 'Widen', tiltBack: 'Back', tiltFwd: 'Forward',
    forks: 'Forks', gear: 'Gear', levelUp: 'Level {n}!',
    starter: 'Starter vehicle', rewardMult: 'Pay x{n}',
  },
};

export const LANGS = [
  { id: 'it', label: 'Italiano', flag: '🇮🇹' },
  { id: 'es', label: 'Español', flag: '🇪🇸' },
  { id: 'en', label: 'English', flag: '🇬🇧' },
];

let current = 'it';

export function detectLang() {
  const nav = (navigator.language || 'it').slice(0, 2);
  return STRINGS[nav] ? nav : 'en';
}

export function setLang(lang) {
  current = STRINGS[lang] ? lang : 'it';
  document.documentElement.lang = current;
}

export function getLang() {
  return current;
}

export function t(key, vars = {}) {
  const s = STRINGS[current][key] ?? STRINGS.it[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

export function fmt(n) {
  return Math.round(n).toLocaleString(current === 'en' ? 'en-US' : current === 'es' ? 'es-ES' : 'it-IT');
}
