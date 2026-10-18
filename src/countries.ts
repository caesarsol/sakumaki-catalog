/**
 * Paesi da cui leggere il catalogo. `nordId` è l'id in https://api.nordvpn.com/v1/servers/countries.
 * Scelti per variare le licenze: Europa (IT, GB, CH, DE, FR, ES), Americhe (US, CA, BR), Oceania (AU).
 * Il Giappone non c'è: il catalogo visto da lì è quasi vuoto e non aggiunge serie guardabili da qui.
 * L'ordine è quello delle colonne nella tabella, prima le europee. Decide anche da quale paese vengono
 * i metadati di una serie (il primo in cui compare), ma fra un paese e l'altro non cambiano.
 */
export const COUNTRIES = [
  { iso2: "IT", nordId: 106 },
  { iso2: "GB", nordId: 227 },
  { iso2: "CH", nordId: 209 },
  { iso2: "DE", nordId: 81 },
  { iso2: "FR", nordId: 74 },
  { iso2: "ES", nordId: 202 },
  { iso2: "US", nordId: 228 },
  { iso2: "BR", nordId: 30 },
  { iso2: "CA", nordId: 38 },
  { iso2: "AU", nordId: 13 },
];
export type Country = (typeof COUNTRIES)[number];
