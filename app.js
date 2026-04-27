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
    const results = await searchEuropePMC(q);
    renderResults(results, q);
  } catch (err) {
    showError(err.message || 'Une erreur est survenue. Veuillez réessayer.');
  }
}

async function searchEuropePMC(query) {
  const url =
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search` +
    `?query=${encodeURIComponent(query)}` +
    `&format=json` +
    `&resultType=core` +
    `&pageSize=10` +
    `&sort=CITED+desc`;

  const data = await fetchJSON(url);
  return data?.resultList?.result ?? [];
}

function renderResults(results, query) {
  hideAll();

  resultsTitle.textContent = 'Résultats — Europe PMC';
  resultsBadge.textContent = `${results.length} résultat${results.length !== 1 ? 's' : ''}`;
  externalLink.href = `https://europepmc.org/search?query=${encodeURIComponent(query)}`;

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

  // Titre
  const titleEl = document.createElement('div');
  titleEl.className = 'result-title';
  const a = document.createElement('a');
  a.href = r.doi
    ? `https://doi.org/${r.doi}`
    : `https://europepmc.org/article/${r.source}/${r.id}`;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = r.title || 'Sans titre';
  titleEl.appendChild(a);
  card.appendChild(titleEl);

  // Méta (journal, année, type)
  const metaEl = document.createElement('div');
  metaEl.className = 'result-meta';
  [
    r.journalTitle,
    r.pubYear,
    r.pubType,
  ].filter(Boolean).forEach((label) => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = label;
    metaEl.appendChild(tag);
  });
  if (metaEl.childNodes.length) card.appendChild(metaEl);

  // Auteurs
  if (r.authorString) {
    const authors = document.createElement('p');
    authors.className = 'result-meta';
    authors.style.color = 'var(--muted)';
    authors.textContent = r.authorString;
    card.appendChild(authors);
  }

  // Résumé
  if (r.abstractText) {
    const abs = document.createElement('p');
    abs.className = 'result-abstract';
    abs.textContent = r.abstractText.slice(0, 300) + (r.abstractText.length > 300 ? '…' : '');
    card.appendChild(abs);
  }

  // Lien
  const link = document.createElement('a');
  link.className = 'result-link';
  link.href = a.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Lire l\'article →';
  card.appendChild(link);

  return card;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function showLoading() {
  resultsSection.hidden = true;
  errorBox.hidden = true;
  loadingEl.hidden = false;
}

function hideAll() {
  loadingEl.hidden = true;
  errorBox.hidden = true;
  resultsSection.hidden = true;
}

function showError(msg) {
  hideAll();
  errorMsg.textContent = msg;
  errorBox.hidden = false;
}

function flashInput() {
  queryEl.style.borderColor = '#f87171';
  queryEl.focus();
  setTimeout(() => { queryEl.style.borderColor = ''; }, 1200);
}

async function fetchJSON(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Erreur réseau (${res.status})`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Délai dépassé. Vérifiez votre connexion et réessayez.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
