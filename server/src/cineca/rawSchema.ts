import { z } from 'zod';

// Raw Cineca API shapes. Every object is a plain z.object(), which zod
// strips of unknown keys by default: nothing beyond what is listed here
// ever reaches the normalizer. Strings are length-capped so a hostile
// response cannot blow up memory or downstream rendering.
const str = (max: number) => z.string().max(max);
const nstr = (max: number) => str(max).nullable().optional().catch(null);

export const clienteSchema = z.object({
  id: str(64),
});

export const linkCalendarioSchema = z.object({
  id: str(64),
  payload: z.object({
    titolo: nstr(300),
    titolo_EN: nstr(300),
    // "libretto_studente" links (a student's personal timetable) carry no
    // titolo - just the course of study/track/year they were built for.
    cdaCorso: nstr(64),
    cdaPercorso: nstr(64),
    annoCorso: nstr(16),
    // Per-insegnamento links carry only activity codes
    codiciAF: z.array(z.string().max(32)).max(20).optional().catch(undefined),
    // Event-based links carry only event ids
    eventiId: z.array(z.string().max(64)).max(500).optional().catch(undefined),
  }),
});

const personaSchema = z.object({
  nome: nstr(150),
  cognome: nstr(150),
});

const edificioSchema = z.object({
  descrizione: nstr(300),
});

const aulaSchema = z.object({
  descrizione: nstr(300),
  edificio: edificioSchema.nullable().optional().catch(null),
});

const partizioneSchema = z.object({
  descrizione: nstr(300),
});

const dettaglioDidatticoSchema = z.object({
  partizione: partizioneSchema.nullable().optional().catch(null),
});

const eventoSchema = z.object({
  online: z.boolean().optional().catch(false),
  dettagliDidattici: z.array(dettaglioDidatticoSchema).max(50).optional().catch([]),
});

const tipoAttivitaSchema = z.object({
  descrizione: nstr(150),
});

export const STATUS_MAP: Record<string, 'ok' | 'cancelled' | 'suspended'> = {
  P: 'ok',
  C: 'ok',
  B: 'ok',
  E: 'ok',
  R: 'ok',
  A: 'cancelled',
  S: 'suspended',
};

export const impegnoSchema = z.object({
  eventoId: str(64).catch(''),
  dataInizio: z.string().datetime({ offset: true }),
  dataFine: z.string().datetime({ offset: true }),
  stato: str(4).catch(''),
  teledidattica: z.boolean().optional().catch(false),
  linkTeledidattica: nstr(2048),
  notePubbliche: nstr(1000),
  notePubbliche_EN: nstr(1000),
  codiceAttivita: nstr(64),
  nome: nstr(300),
  nome_EN: nstr(300),
  attivitaFuoriSede: z.boolean().optional().catch(false),
  docenti: z.array(personaSchema).max(30).optional().catch([]),
  aule: z.array(aulaSchema).max(20).optional().catch([]),
  tipoAttivita: tipoAttivitaSchema.nullable().optional().catch(null),
  evento: eventoSchema.nullable().optional().catch(null),
});

export const impegniResponseSchema = z.array(impegnoSchema).max(5000);

export type RawImpegno = z.infer<typeof impegnoSchema>;
