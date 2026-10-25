/**
 * Solo per la pagina: table.ts lo impacchetta (Bun.build, formato iife) e lo mette dentro index.html.
 * Espone come globali la parte di TanStack Virtual che la pagina usa, senza framework, e il motore delle
 * formule, che sta in un modulo suo per poterlo provare con bun test.
 */
import { Virtualizer, elementScroll, observeElementOffset, observeElementRect } from "@tanstack/virtual-core";
import * as Formula from "./formula";

Object.assign(globalThis, { VirtualCore: { Virtualizer, elementScroll, observeElementOffset, observeElementRect }, Formula });
