'use strict';

const queryEl          = document.getElementById('query');
const searchBtn        = document.getElementById('searchBtn');
const loadingEl        = document.getElementById('loading');
const errorBox         = document.getElementById('errorBox');
const errorMsg         = document.getElementById('errorMsg');
const resultsSection   = document.getElementById('resultsSection');
const resultsTitle     = document.getElementById('resultsTitle');
const resultsBadge     = document.getElementById('resultsBadge');
const resultsContainer = document.getElementById('resultsContainer');
const externalLink     = document.getElementById('externalLink');

searchBtn.addEventListener('click', runSearch);
queryEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runSearch();
});

async function runSearch() {
  const q = queryEl.value.trim();
  if (!q) { flashInput(); return; }

  showLoading();

  try {
    const results = await searchPubMed(q);
    renderResults(results, q);
  } catch (err) {
    showError('Erreur : ' + (err.message || 'Impossible de contacter PubMed. Vérifiez votre connexion.'));
  }
}

// ── PubMed via NCBI E-utilities (CORS enabled, gratuit, sans clé) ────────────

async function searchPubMed(query) {
  // Étape 1 : récupérer les IDs
  const searchData = await get(
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi' +
    '?db=pubmed&retmode=json&retmax=10&term=' + encodeURIComponent(query)
  );

  const ids = searchData?.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  // Étape 2 : récupérer les détails
  const summaryData = await get(
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi' +
    '?db=pubmed&retmode=json&id=' + ids.join(',')
  );

  const resultMap = summaryData?.result ?? {};

  return ids.map((id) => {
    const item = resultMap[id];
    if (!item || typeof item !== 'object') return null;
    return {
      id,
      title:   item.title    || 'Sans titre',
      journal: item.source   || '',
      year:    (item.pubdate || '').slice(0, 4),
      authors: (item.authors ?? []).slice(0, 5).map((a) => a.name).join(', '),
      url:     'https://pubmed.ncbi.nlm.nih.gov/' + id + '/',
    };
  }).filter(Boolean);
}

// Fetch simple avec timeout 10s
async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('Réponse HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Délai dépassé (10 s). Vérifiez votre connexion.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Rendu ────────────────────────────────────────────────────────────────────

function renderResults(results, query) {
  hideAll();

  resultsTitle.textContent  = 'Résultats PubMed';
  resultsBadge.textContent  = results.length + ' résultat' + (results.length !== 1 ? 's' : '');
  externalLink.href         = 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(query);

  resultsContainer.innerHTML = '';

  if (results.length === 0) {
    resultsContainer.innerHTML =
      '<p style="color:var(--muted);font-size:.9rem">Aucun résultat. Essayez en anglais ou avec d\'autres mots-clés.</p>';
  } else {
    results.forEach((r) => resultsContainer.appendChild(buildCard(r)));
  }

  resultsSection.hidden = false;
}

function buildCard(r) {
  const card = document.createElement('div');
  card.className = 'result-item';

  // Titre + lien
  const titleEl = document.createElement('div');
  titleEl.className = 'result-title';
  const a = document.createElement('a');
  a.href   = r.url;
  a.target = '_blank';
  a.rel    = 'noopener noreferrer';
  a.textContent = r.title;
  titleEl.appendChild(a);
  card.appendChild(titleEl);

  // Journal · année
  const meta = document.createElement('div');
  meta.className = 'result-meta';
  [r.journal, r.year].filter(Boolean).forEach((label) => {
    const tag = document.createElement('span');
    tag.className   = 'tag';
    tag.textContent = label;
    meta.appendChild(tag);
  });
  if (meta.childNodes.length) card.appendChild(meta);

  // Auteurs
  if (r.authors) {
    const auth = document.createElement('p');
    auth.className   = 'result-meta';
    auth.textContent = r.authors;
    card.appendChild(auth);
  }

  // Lien
  const link = document.createElement('a');
  link.className   = 'result-link';
  link.href        = r.url;
  link.target      = '_blank';
  link.rel         = 'noopener noreferrer';
  link.textContent = 'Lire sur PubMed →';
  card.appendChild(link);

  return card;
}

// ── UI helpers ───────────────────────────────────────────────────────────────

function showLoading() {
  resultsSection.hidden = true;
  errorBox.hidden       = true;
  loadingEl.hidden      = false;
}

function hideAll() {
  loadingEl.hidden      = true;
  errorBox.hidden       = true;
  resultsSection.hidden = true;
}

function showError(msg) {
  hideAll();
  errorMsg.textContent = msg;
  errorBox.hidden      = false;
}

function flashInput() {
  queryEl.style.borderColor = '#f87171';
  queryEl.focus();
  setTimeout(() => { queryEl.style.borderColor = ''; }, 1200);
}
