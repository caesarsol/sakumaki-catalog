/**
 * Solo per la pagina: table.ts lo impacchetta (Bun.build, formato iife) e lo mette dentro index.html.
 * Espone come globale la parte di TanStack Virtual che la pagina usa, senza framework.
 */
import { Virtualizer, elementScroll, observeElementOffset, observeElementRect } from "@tanstack/virtual-core";

Object.assign(globalThis, { VirtualCore: { Virtualizer, elementScroll, observeElementOffset, observeElementRect } });
