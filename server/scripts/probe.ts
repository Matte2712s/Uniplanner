// Fetches a real Cineca calendar and saves fixtures used by the test suite.
// Usage: npm run probe -- <host> <linkCalendarioId>
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fetchCinecaJson } from '../src/cineca/client.ts';

const [host, linkCalendarioId] = process.argv.slice(2);
if (!host || !linkCalendarioId) {
  console.error('Usage: npm run probe -- <host> <linkCalendarioId>');
  process.exit(1);
}

const cliente = (await fetchCinecaJson(host, '/api/Clienti/cercaPerDominio', {
  method: 'GET',
  query: { dominio: host },
})) as { id: string };
console.log('clienteId', cliente.id);

const calendario = await fetchCinecaJson(host, '/api/LinkCalendario/searchCalendarioPubblico', {
  method: 'POST',
  body: { linkCalendarioId, filter: { clienteId: cliente.id } },
});
writeFileSync(path.join(import.meta.dirname, '../test/fixtures/calendario.json'), JSON.stringify(calendario, null, 2));

const weekStart = new Date();
weekStart.setUTCHours(0, 0, 0, 0);
const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

const impegni = await fetchCinecaJson(host, '/api/Impegni/getImpegniCalendarioPubblico', {
  method: 'POST',
  body: {
    linkCalendarioId,
    clienteId: cliente.id,
    dataInizio: weekStart.toISOString(),
    dataFine: weekEnd.toISOString(),
    mostraImpegniAnnullati: true,
    mostraIndisponibilitaTotali: false,
    pianificazioneTemplate: false,
  },
});
const sample = Array.isArray(impegni) ? impegni.slice(0, 5) : impegni;
writeFileSync(path.join(import.meta.dirname, '../test/fixtures/impegni.json'), JSON.stringify(sample, null, 2));
console.log('saved fixtures');
