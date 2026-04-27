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
  try {
    const searchRes = await fetchJSON(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` +
      `?db=pubmed&term=${encodeURIComponent(query)}&retmax=8&retmode=json`
    );
    const ids = searchRes?.esearchresult?.idlist ?? [];
    if (ids.length === 0) return buildOpenEvidenceFallback(query);

    const summaryRes = await fetchJSON(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi` +
      `?db=pubmed&id=${ids.join(',')}&retmode=json`
    );
    const result = summaryRes?.result ?? {};

    const items = ids.map((id) => {
      const item = result[id];
      if (!item) return null;
      const authors = (item.authors ?? []).slice(0, 3).map((a) => a.name).join(', ');
      return {
        title: item.title || 'Sans titre',
        excerpt: [item.source, item.pubdate, authors].filter(Boolean).join(' · '),
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        meta: [{ label: item.pubdate || '' }, { label: item.source || '' }],
      };
    }).filter(Boolean);

    return items.length > 0 ? items : buildOpenEvidenceFallback(query);
  } catch {
    return buildOpenEvidenceFallback(query);
  }
}

function buildOpenEvidenceFallback(query) {
  return [
    {
      title: `Rechercher "${query}" sur PubMed`,
      excerpt: 'PubMed donne accès à plus de 35 millions de références d\'articles biomédicaux et sciences de la vie.',
      url: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`,
      meta: [{ label: 'PubMed – NCBI' }],
    },
    {
      title: `Rechercher "${query}" sur Open Evidence`,
      excerpt: 'Open Evidence synthétise la littérature médicale pour répondre aux questions cliniques.',
      url: `https://www.openevidence.com/search?q=${encodeURIComponent(query)}`,
      meta: [{ label: 'Open Evidence' }],
    },
    {
      title: `Rechercher "${query}" sur Cochrane Library`,
      excerpt: 'La Cochrane Library regroupe les meilleures revues systématiques et méta-analyses en santé.',
      url: `https://www.cochranelibrary.com/search?searchBy=6&searchText=${encodeURIComponent(query)}`,
      meta: [{ label: 'Cochrane Library' }],
    },
  ];
}

async function searchHAS(query) {
  try {
    const data = await fetchJSON(
      `https://www.data.gouv.fr/api/1/datasets/?q=${encodeURIComponent('HAS ' + query)}&page_size=8`
    );
    const items = (data?.data ?? []).filter((d) =>
      d.organization?.name?.toLowerCase().includes('has') ||
      d.title?.toLowerCase().includes('has') ||
      d.title?.toLowerCase().includes('recommandation')
    );
    if (items.length > 0) {
      return items.map((item) => ({
        title: item.title || 'Document HAS',
        excerpt: item.description
          ? stripHtml(item.description).slice(0, 220) + '…'
          : 'Publication disponible sur data.gouv.fr',
        url: item.page || 'https://www.has-sante.fr',
        meta: [
          { label: item.organization?.name ?? 'HAS' },
          { label: item.last_modified ? fmtDate(item.last_modified) : '' },
        ],
      }));
    }
  } catch { /* fall through to static fallback */ }

  return buildHASFallback(query);
}

function buildHASFallback(query) {
  return [
    {
      title: `Rechercher "${query}" sur le portail HAS`,
      excerpt: 'La HAS publie ses recommandations de bonne pratique, guides du parcours de soins et fiches mémo.',
      url: `https://www.has-sante.fr/jcms/fc_1249599/fr/recherche?text=${encodeURIComponent(query)}`,
      meta: [{ label: 'HAS – Haute Autorité de Santé' }],
    },
    {
      title: `Rechercher "${query}" sur l'ANSM`,
      excerpt: "L'ANSM publie les recommandations de bon usage des médicaments et les décisions réglementaires.",
      url: `https://ansm.sante.fr/rechercher?queryText=${encodeURIComponent(query)}`,
      meta: [{ label: 'ANSM' }],
    },
    {
      title: `Rechercher "${query}" sur Ameli Pro`,
      excerpt: 'Ameli Pro met à disposition les protocoles de soins et nomenclatures pour les professionnels de santé.',
      url: `https://www.ameli.fr/assure/recherche?keywords=${encodeURIComponent(query)}`,
      meta: [{ label: 'Ameli Pro – Assurance Maladie' }],
    },
    {
      title: `Rechercher "${query}" sur VIDAL`,
      excerpt: 'VIDAL propose des fiches pratiques et recommandations pour les professionnels de santé.',
      url: `https://www.vidal.fr/recherche/index/?q=${encodeURIComponent(query)}`,
      meta: [{ label: 'VIDAL' }],
    },
  ];
}

async function searchMedicaments(query) {
  try {
    const data = await fetchJSON(
      `https://www.data.gouv.fr/api/1/datasets/?q=${encodeURIComponent(query)}&page_size=8&organization=534fff91a3a7292c64a77ede`
    );
    const items = data?.data ?? [];
    if (items.length > 0) {
      return [
        ...items.map((item) => ({
          title: item.title || 'Spécialité médicamenteuse',
          excerpt: item.description
            ? stripHtml(item.description).slice(0, 220) + '…'
            : 'Données disponibles sur la base publique des médicaments.',
          url: item.page || 'https://base-donnees-publique.medicaments.gouv.fr/',
          meta: [{ label: 'ANSM – Base publique médicaments' }],
        })),
        ...buildMedicamentFallback(query),
      ];
    }
  } catch { /* fall through */ }

  return buildMedicamentFallback(query);
}

function buildMedicamentFallback(query) {
  return [
    {
      title: `Rechercher "${query}" dans la base des médicaments`,
      excerpt: "La base de données publique des médicaments donne accès aux RCP, notices et rapports d'évaluation.",
      url: `https://base-donnees-publique.medicaments.gouv.fr/recherche.php?specianame=${encodeURIComponent(query)}`,
      meta: [{ label: 'Base de données publique – ANSM / Min. Santé' }],
    },
    {
      title: `Rechercher "${query}" sur VIDAL`,
      excerpt: 'VIDAL propose les fiches de données de sécurité, posologies et interactions médicamenteuses.',
      url: `https://www.vidal.fr/recherche/index/?q=${encodeURIComponent(query)}`,
      meta: [{ label: 'VIDAL' }],
    },
    {
      title: `Rechercher "${query}" sur Thériaque`,
      excerpt: 'Thériaque est la base nationale d\'informations sur les médicaments disponibles en France.',
      url: `https://www.theriaque.org/apps/recherche/rech_simple.php?UTIL=PRO&QUOI=SPECIALITE&NOM=${encodeURIComponent(query)}`,
      meta: [{ label: 'Thériaque' }],
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

async function fetchJSON(url, timeoutMs = 8000) {
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
    if (err.name === 'AbortError') throw new Error('La requête a expiré (timeout). Vérifiez votre connexion.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
