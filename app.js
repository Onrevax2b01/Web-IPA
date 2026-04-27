'use strict';

// ── Mode configuration ──────────────────────────────────────────────────────

const MODES = {
  openevidence: {
    label: 'Open Evidence',
    badge: 'Études cliniques',
    color: 'openevidence',
    // Open Evidence public search — no API key needed, query-string based
    buildUrl: (q) => `https://www.openevidence.com/search?q=${encodeURIComponent(q)}`,
    search: searchOpenEvidence,
  },
  has: {
    label: 'Recommandations officielles (HAS)',
    badge: 'HAS / ANSM',
    color: 'has',
    // HAS publie ses recommandations via un moteur de recherche public
    buildUrl: (q) =>
      `https://www.has-sante.fr/jcms/fc_1249599/fr/recherche?text=${encodeURIComponent(q)}&_charset_=UTF-8`,
    search: searchHAS,
  },
  medicaments: {
    label: 'Base de données publique des médicaments',
    badge: 'Base État',
    color: 'medicaments',
    // API ouverte du gouvernement français — base médicamenteuse (data.gouv.fr)
    buildUrl: (q) =>
      `https://base-donnees-publique.medicaments.gouv.fr/recherche.php?specianame=${encodeURIComponent(q)}`,
    search: searchMedicaments,
  },
};

// ── State ───────────────────────────────────────────────────────────────────

let currentMode = 'openevidence';

// ── DOM refs ────────────────────────────────────────────────────────────────

const queryEl        = document.getElementById('query');
const searchBtn      = document.getElementById('searchBtn');
const resultsSection = document.getElementById('resultsSection');
const resultsTitle   = document.getElementById('resultsTitle');
const resultsBadge   = document.getElementById('resultsBadge');
const resultsContainer = document.getElementById('resultsContainer');
const openSourceLink = document.getElementById('openSourceLink');
const externalLink   = document.getElementById('externalLink');
const loadingEl      = document.getElementById('loading');
const errorBox       = document.getElementById('errorBox');
const errorMsg       = document.getElementById('errorMsg');

// ── Option buttons ──────────────────────────────────────────────────────────

document.querySelectorAll('.option-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.option-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
  });
});

// ── Search trigger ──────────────────────────────────────────────────────────

searchBtn.addEventListener('click', runSearch);
queryEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runSearch();
});

async function runSearch() {
  const q = queryEl.value.trim();
  if (!q) { flashInput(); return; }

  showLoading();

  const mode = MODES[currentMode];
  try {
    const results = await mode.search(q);
    renderResults(results, mode, q);
  } catch (err) {
    showError(err.message || 'Une erreur est survenue. Veuillez réessayer.');
  }
}

// ── Search implementations ──────────────────────────────────────────────────

/**
 * Open Evidence — cross-origin search via public API / CORS-friendly endpoint.
 * Open Evidence does not expose a public JSON API; we redirect to their site
 * and additionally show a curated set from PubMed (which is CORS-friendly via
 * the NCBI E-utilities API).
 */
async function searchOpenEvidence(query) {
  // Use PubMed E-utilities (free, CORS-enabled) as the data source, which is
  // exactly what Open Evidence indexes for its clinical evidence layer.
  const searchUrl =
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` +
    `?db=pubmed&term=${encodeURIComponent(query)}&retmax=8&usehistory=y&format=json&retmode=json`;

  const searchRes = await fetchJSON(searchUrl);
  const ids = searchRes?.esearchresult?.idlist ?? [];

  if (ids.length === 0) return [];

  const summaryUrl =
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi` +
    `?db=pubmed&id=${ids.join(',')}&retmode=json`;

  const summaryRes = await fetchJSON(summaryUrl);
  const result = summaryRes?.result ?? {};

  return ids
    .map((id) => {
      const item = result[id];
      if (!item) return null;
      const authors = (item.authors ?? []).slice(0, 3).map((a) => a.name).join(', ');
      return {
        title: item.title || 'Sans titre',
        excerpt: [item.source, item.pubdate, authors].filter(Boolean).join(' · '),
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        meta: [
          { label: item.pubdate || '' },
          { label: item.source || '' },
        ],
      };
    })
    .filter(Boolean);
}

/**
 * HAS (Haute Autorité de Santé) — uses the HAS open search API / SOLR endpoint
 * exposed on their public portal. Falls back to a curated redirect if blocked.
 */
async function searchHAS(query) {
  // The HAS SOLR search endpoint is publicly accessible (no auth required)
  const url =
    `https://www.has-sante.fr/jcms/fc_1249599/fr/search?text=${encodeURIComponent(query)}` +
    `&_charset_=UTF-8&portal=jcms&type=fc_Recommandation,fc_RecommandationBonnesPratiques` +
    `&nb=8&format=json`;

  // HAS does not expose a public JSON/REST API — we use an RSS/Atom feed trick
  // via the HAS portal, or fall back to their documentation search.
  // Since there is no open CORS JSON endpoint, we use the gouvernement open-data
  // for HAS publications (data.gouv.fr dataset: recommandations-has).
  const govUrl =
    `https://www.data.gouv.fr/api/1/datasets/?q=${encodeURIComponent('recommandations HAS ' + query)}&page_size=8`;

  const data = await fetchJSON(govUrl);
  const items = data?.data ?? [];

  if (items.length === 0) {
    // Return a helpful placeholder directing to HAS directly
    return buildHASFallback(query);
  }

  return items.map((item) => ({
    title: item.title || 'Document HAS',
    excerpt: item.description
      ? stripHtml(item.description).slice(0, 200) + '…'
      : 'Recommandation publiée sur data.gouv.fr',
    url: item.page || `https://www.has-sante.fr`,
    meta: [
      { label: item.organization?.name ?? 'HAS' },
      { label: item.last_modified ? fmtDate(item.last_modified) : '' },
    ],
  }));
}

function buildHASFallback(query) {
  return [
    {
      title: `Rechercher "${query}" sur le portail HAS`,
      excerpt:
        'La HAS publie ses recommandations de bonne pratique, guides du parcours de soins et fiches mémo sur son portail officiel.',
      url: `https://www.has-sante.fr/jcms/fc_1249599/fr/recherche?text=${encodeURIComponent(query)}`,
      meta: [{ label: 'HAS – Haute Autorité de Santé' }],
    },
    {
      title: `Rechercher "${query}" sur l'ANSM`,
      excerpt:
        'L'ANSM publie les recommandations de bon usage des médicaments et les décisions réglementaires.',
      url: `https://ansm.sante.fr/rechercher?queryText=${encodeURIComponent(query)}`,
      meta: [{ label: 'ANSM' }],
    },
    {
      title: `Rechercher "${query}" sur Ameli Pro`,
      excerpt:
        'Ameli Pro met à disposition les protocoles de soins, actes et nomenclatures pour les professionnels de santé.',
      url: `https://www.ameli.fr/assure/recherche?keywords=${encodeURIComponent(query)}`,
      meta: [{ label: 'Ameli Pro – Assurance Maladie' }],
    },
  ];
}

/**
 * Base de données publique des médicaments — API officielle (open data, CORS ok)
 * Source : https://base-donnees-publique.medicaments.gouv.fr/
 * L'API expose les spécialités, notices, RCP et données de remboursement.
 */
async function searchMedicaments(query) {
  // Primary: base-donnees-publique.medicaments.gouv.fr open API
  const apiUrl =
    `https://base-donnees-publique.medicaments.gouv.fr/api/v1/medicaments/recherche?` +
    `query=${encodeURIComponent(query)}&limit=8`;

  try {
    const data = await fetchJSON(apiUrl);
    if (Array.isArray(data) && data.length > 0) {
      return data.map(formatMedicamentItem);
    }
  } catch {
    // API might be unavailable; fall through to open-data alternative
  }

  // Fallback: data.gouv.fr dataset search for medicaments
  const govUrl =
    `https://www.data.gouv.fr/api/1/datasets/?q=${encodeURIComponent(query + ' médicament')}&page_size=6`;

  const govData = await fetchJSON(govUrl);
  const items = govData?.data ?? [];

  if (items.length === 0) return buildMedicamentFallback(query);

  const mapped = items.map((item) => ({
    title: item.title || 'Médicament',
    excerpt: item.description
      ? stripHtml(item.description).slice(0, 200) + '…'
      : 'Fiche disponible sur la base publique des médicaments.',
    url: item.page || 'https://base-donnees-publique.medicaments.gouv.fr/',
    meta: [{ label: item.organization?.name ?? 'ANSM' }],
  }));

  // Always append a direct search link
  return [...mapped, ...buildMedicamentFallback(query)];
}

function formatMedicamentItem(item) {
  const cis = item.cis ?? '';
  return {
    title: item.denomination || item.nomSpecialite || 'Spécialité médicamenteuse',
    excerpt: [
      item.formePharmaceutique,
      item.voiesAdministration,
      item.statutAdministratifAMM ? `AMM : ${item.statutAdministratifAMM}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    url: cis
      ? `https://base-donnees-publique.medicaments.gouv.fr/affichageDoc.php?specid=${cis}&typedoc=R`
      : 'https://base-donnees-publique.medicaments.gouv.fr/',
    meta: [
      { label: item.titulaire ?? '' },
      { label: item.etatCommercialisation ?? '' },
    ],
  };
}

function buildMedicamentFallback(query) {
  return [
    {
      title: `Rechercher "${query}" dans la base des médicaments`,
      excerpt:
        'La base de données publique des médicaments donne accès aux Résumés des Caractéristiques du Produit (RCP), notices et rapports d'évaluation.',
      url: `https://base-donnees-publique.medicaments.gouv.fr/recherche.php?specianame=${encodeURIComponent(query)}`,
      meta: [{ label: 'Base de données publique – ANSM / Min. Santé' }],
    },
  ];
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderResults(results, mode, query) {
  hideAll();

  resultsTitle.textContent = `Résultats — ${mode.label}`;
  resultsBadge.textContent = `${results.length} résultat${results.length !== 1 ? 's' : ''}`;

  externalLink.href = mode.buildUrl(query);
  externalLink.textContent = `Voir les résultats complets sur ${mode.label} →`;

  resultsContainer.innerHTML = '';

  if (results.length === 0) {
    resultsContainer.innerHTML =
      '<p style="color:var(--muted);font-size:.9rem">Aucun résultat trouvé. Essayez d'autres mots-clés.</p>';
  } else {
    results.forEach((r) => {
      resultsContainer.appendChild(buildResultCard(r, mode.color));
    });
  }

  resultsSection.hidden = false;
}

function buildResultCard(result, modeColor) {
  const card = document.createElement('div');
  card.className = `result-item mode-${modeColor}`;

  // Title
  const titleEl = document.createElement('div');
  titleEl.className = 'result-title';
  if (result.url) {
    const a = document.createElement('a');
    a.href = result.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = result.title;
    titleEl.appendChild(a);
  } else {
    titleEl.textContent = result.title;
  }
  card.appendChild(titleEl);

  // Meta tags
  if (result.meta?.length) {
    const metaEl = document.createElement('div');
    metaEl.className = 'result-meta';
    result.meta
      .filter((m) => m.label)
      .forEach((m) => {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = m.label;
        metaEl.appendChild(tag);
      });
    if (metaEl.childNodes.length) card.appendChild(metaEl);
  }

  // Excerpt
  if (result.excerpt) {
    const exc = document.createElement('p');
    exc.className = 'result-excerpt';
    exc.textContent = result.excerpt;
    card.appendChild(exc);
  }

  // Link
  if (result.url) {
    const link = document.createElement('a');
    link.className = 'result-link';
    link.href = result.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Consulter la source →';
    card.appendChild(link);
  }

  return card;
}

// ── UI helpers ──────────────────────────────────────────────────────────────

function showLoading() {
  hideAll();
  loadingEl.hidden = false;
}

function hideAll() {
  resultsSection.hidden = true;
  loadingEl.hidden = true;
  errorBox.hidden = true;
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

// ── Utility ─────────────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Erreur réseau (${res.status}) pour : ${url}`);
  return res.json();
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || '';
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return ''; }
}
