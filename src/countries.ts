/**
 * Paesi da cui leggere il catalogo. `nordId` è l'id in https://api.nordvpn.com/v1/servers/countries.
 * Scelti per variare le licenze: Europa (IT, GB, CH, DE, FR), Americhe (US, CA, BR), Asia (JP), Oceania (AU).
 * L'ordine conta: i metadati di una serie vengono dal primo paese in cui compare.
 */
export const COUNTRIES = [
  { iso2: "IT", nordId: 106 },
  { iso2: "GB", nordId: 227 },
  { iso2: "CH", nordId: 209 },
  { iso2: "US", nordId: 228 },
  { iso2: "JP", nordId: 108 },
  { iso2: "DE", nordId: 81 },
  { iso2: "FR", nordId: 74 },
  { iso2: "BR", nordId: 30 },
  { iso2: "CA", nordId: 38 },
  { iso2: "AU", nordId: 13 },
];
export type Country = (typeof COUNTRIES)[number];
