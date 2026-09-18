// Copia in src/constants.ts (ignorato da git) e compila con gli host del servizio, senza slash finale.
/** Host delle API: il sottodominio beta-api, perché quello del sito mette /auth e /content dietro la managed challenge di Cloudflare. */
export const API_BASE = "https://beta-api.example.com";
/** Host del sito, per i link alle serie nella tabella. */
export const SITE_BASE = "https://www.example.com";
