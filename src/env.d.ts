/**
 * El sello del build, inyectado por `vite.config.ts` con `define`.
 *
 * Se declara aquí y no en un `.ts` porque no es código: es una constante que
 * el empaquetador sustituye por un literal antes de compilar.
 */
declare const SELLO_BUILD: string
