'use strict';

// ── DOM refs ─────────────────────────────────────────────────────────────────

const queryEl          = document.getElementById('query');
const searchBtn        = document.getElementById('searchBtn');
const loadingEl        = document.getElementById('loading');
const loadingMsg       = document.getElementById('loadingMsg');
const errorBox         = document.getElementById('errorBox');
const errorMsg         = document.getElementById('errorMsg');
const translationBox   = document.getElementById('translationBox');
const translatedQuery  = document.getElementById('translatedQuery');
const conversionBox    = document.getElementById('conversionBox');
const conversionText   = document.getElementById('conversionText');
const dciBox           = document.getElementById('dciBox');
const dciNameEl        = document.getElementById('dciName');
const meshBox          = document.getElementById('meshBox');
const meshTermsEl      = document.getElementById('meshTerms');
const filterCard       = document.getElementById('filterCard');
const resultsSection   = document.getElementById('resultsSection');
const resultsTitle     = document.getElementById('resultsTitle');
const resultsBadge     = document.getElementById('resultsBadge');
const resultsContainer = document.getElementById('resultsContainer');
const externalLink     = document.getElementById('externalLink');
const synthesisBtn     = document.getElementById('synthesisBtn');
const synthesisCard    = document.getElementById('synthesisCard');
const synthesisBadge   = document.getElementById('synthesisBadge');
const synthesisAbstracts = document.getElementById('synthesisAbstracts');
const copyBtn          = document.getElementById('copyBtn');
const copyConfirm      = document.getElementById('copyConfirm');

// ── State ─────────────────────────────────────────────────────────────────────

let currentPubmedQuery = '';
let currentDisplayQuery = '';
let currentArticleIds  = [];
let activeFilter       = '';
let activePeriod       = 0;

// ── Events ───────────────────────────────────────────────────────────────────

searchBtn.addEventListener('click', runSearch);
queryEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runSearch();
});

// Filtres type d'étude
document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.pt;
    applyFilters();
  });
});

// Filtres période
document.querySelectorAll('.period-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activePeriod = parseInt(btn.dataset.years, 10);
    applyFilters();
  });
});

synthesisBtn.addEventListener('click', generateSynthesis);
copyBtn.addEventListener('click', copyContext);

// ── Recherche principale ──────────────────────────────────────────────────────

async function runSearch() {
  const q = queryEl.value.trim();
  if (!q) { flashInput(); return; }

  // Réinitialiser les filtres
  activeFilter = '';
  activePeriod = 0;
  document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  document.querySelector('.filter-btn[data-pt=""]').classList.add('active');
  document.querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
  document.querySelector('.period-btn[data-years="0"]').classList.add('active');

  showLoading('Traduction et recherche en cours…');
  hideInfoBoxes();

  try {
    // 1. Traduction FR → EN
    const english = await translate(q);
    if (english && english.toLowerCase() !== q.toLowerCase()) {
      translatedQuery.textContent = english;
      translationBox.hidden = false;
    }

    // 2. DCI : identifier le principe actif mot par mot
    let searchTerm = english || q;
    const dciResult = await findDCI(searchTerm);
    if (dciResult) {
      const isBrandConversion = dciResult.dci.toLowerCase() !== dciResult.brand.toLowerCase();
      if (isBrandConversion) {
        conversionText.textContent = dciResult.brand + ' → ' + dciResult.dci;
        conversionBox.hidden = false;
      } else {
        dciNameEl.textContent = dciResult.dci;
        dciBox.hidden = false;
      }
      searchTerm = searchTerm.replace(new RegExp(dciResult.brand, 'gi'), dciResult.dci);
    }

    // 3. Recherche PubMed + termes MeSH
    const { ids, meshTerms } = await searchPubMedWithMeSH(searchTerm);
    if (meshTerms.length > 0) showMeSHTerms(meshTerms);

    currentPubmedQuery  = searchTerm;
    currentDisplayQuery = q;
    currentArticleIds   = ids;

    // 4. Détails des articles
    const results = await getArticleDetails(ids);
    renderResults(results, searchTerm);
  } catch (err) {
    showError('Erreur : ' + (err.message || 'Impossible de contacter PubMed.'));
  }
}

// ── Filtres ───────────────────────────────────────────────────────────────────

async function applyFilters() {
  if (!currentPubmedQuery) return;
  showLoading('Application des filtres…');
  synthesisCard.hidden = true;

  try {
    let query = currentPubmedQuery;
    if (activeFilter)  query += ' AND (' + activeFilter + ')';
    if (activePeriod > 0) {
      const fromYear = new Date().getFullYear() - activePeriod;
      query += ' AND ("' + fromYear + '/01/01"[PDAT] : "3000/12/31"[PDAT])';
    }

    const { ids, meshTerms } = await searchPubMedWithMeSH(query);
    if (meshTerms.length > 0) showMeSHTerms(meshTerms);
    currentArticleIds = ids;

    const results = await getArticleDetails(ids);
    renderResults(results, query);
  } catch (err) {
    showError('Erreur lors du filtrage : ' + err.message);
  }
}

// ── Synthèse clinique ─────────────────────────────────────────────────────────

async function generateSynthesis() {
  if (currentArticleIds.length === 0) return;
  synthesisBtn.disabled = true;
  synthesisCard.hidden  = true;
  showLoading('Récupération des résumés…');

  try {
    const abstracts = await fetchAbstracts(currentArticleIds.slice(0, 8));
    hideAll();
    resultsSection.hidden = false;
    filterCard.hidden     = false;
    renderSynthesis(abstracts);
  } catch (err) {
    showError('Erreur lors de la récupération des résumés : ' + err.message);
  } finally {
    synthesisBtn.disabled = false;
  }
}

async function fetchAbstracts(ids) {
  const url =
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi' +
    '?db=pubmed&rettype=abstract&retmode=xml&id=' + ids.join(',');

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('Erreur HTTP ' + res.status);
  const xml  = await res.text();
  const doc  = new DOMParser().parseFromString(xml, 'text/xml');

  return Array.from(doc.querySelectorAll('PubmedArticle')).map((article) => {
    const pmid    = article.querySelector('PMID')?.textContent ?? '';
    const title   = article.querySelector('ArticleTitle')?.textContent ?? 'Sans titre';
    const year    = article.querySelector('PubDate > Year')?.textContent
                 ?? article.querySelector('PubDate > MedlineDate')?.textContent?.slice(0, 4) ?? '';
    const journal = article.querySelector('Journal > Title')?.textContent ?? '';

    // Résumé — peut avoir des sections étiquetées (BACKGROUND, METHODS…)
    const abstractSections = article.querySelectorAll('AbstractText');
    let abstract = '';
    abstractSections.forEach((s) => {
      const label = s.getAttribute('Label');
      abstract += (label ? label + ' : ' : '') + s.textContent.trim() + '\n\n';
    });

    return { pmid, title, journal, year, abstract: abstract.trim() };
  });
}

function renderSynthesis(abstracts) {
  synthesisAbstracts.innerHTML = '';
  synthesisBadge.textContent   = abstracts.length + ' article' + (abstracts.length > 1 ? 's' : '');

  abstracts.forEach((a, i) => {
    const item = document.createElement('div');
    item.className = 'abstract-item';

    const header = document.createElement('div');
    header.className = 'abstract-header';
    header.innerHTML =
      '<span class="abstract-title">' + escHtml(a.title) + '</span>' +
      '<span class="abstract-toggle">▼ Voir le résumé</span>';

    const body = document.createElement('div');
    body.className = 'abstract-body';
    body.textContent = a.abstract || 'Résumé non disponible.';
    body.hidden = i > 0; // premier article ouvert par défaut

    header.querySelector('.abstract-toggle').textContent = i === 0 ? '▲ Masquer' : '▼ Voir le résumé';

    header.addEventListener('click', () => {
      const open = !body.hidden;
      body.hidden = open;
      header.querySelector('.abstract-toggle').textContent = open ? '▼ Voir le résumé' : '▲ Masquer';
    });

    item.appendChild(header);
    item.appendChild(body);
    synthesisAbstracts.appendChild(item);
  });

  synthesisCard.hidden = false;
  synthesisCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Copier le contexte pour IA ────────────────────────────────────────────────

async function copyContext() {
  const abstracts = Array.from(synthesisAbstracts.querySelectorAll('.abstract-item')).map((item) => {
    const title    = item.querySelector('.abstract-title').textContent;
    const abstract = item.querySelector('.abstract-body').textContent;
    return { title, abstract };
  });

  const prompt =
    'Question clinique : ' + currentDisplayQuery + '\n\n' +
    'Voici les résumés de ' + abstracts.length + ' études scientifiques pertinentes :\n\n' +
    abstracts.map((a, i) =>
      '--- Article ' + (i + 1) + ' ---\n' +
      'Titre : ' + a.title + '\n' +
      'Résumé : ' + a.abstract
    ).join('\n\n') +
    '\n\n---\n' +
    'Sur la base de ces études, fournis une synthèse clinique répondant à la question en identifiant :\n' +
    '1. Les principales recommandations\n' +
    '2. Le niveau de preuve (fort / modéré / faible)\n' +
    '3. Les points de vigilance pour la pratique infirmière avancée\n' +
    'Rédige la réponse en français.';

  try {
    await navigator.clipboard.writeText(prompt);
    copyConfirm.hidden = false;
    setTimeout(() => { copyConfirm.hidden = true; }, 2500);
  } catch {
    // Fallback : sélection manuelle
    const ta = document.createElement('textarea');
    ta.value = prompt;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    copyConfirm.hidden = false;
    setTimeout(() => { copyConfirm.hidden = true; }, 2500);
  }
}

// ── PubMed ────────────────────────────────────────────────────────────────────

async function searchPubMedWithMeSH(query) {
  const data   = await get(
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi' +
    '?db=pubmed&retmode=json&retmax=10&term=' + encodeURIComponent(query)
  );
  const result = data?.esearchresult ?? {};
  const ids    = result.idlist ?? [];
  const meshTerms = [...new Set(
    (result.translationset ?? [])
      .flatMap((t) => [...(t.to || '').matchAll(/"([^"]+)"\[MeSH Terms\]/gi)].map((m) => m[1]))
  )];
  return { ids, meshTerms };
}

async function getArticleDetails(ids) {
  if (ids.length === 0) return [];
  const data      = await get(
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi' +
    '?db=pubmed&retmode=json&id=' + ids.join(',')
  );
  const resultMap = data?.result ?? {};
  return ids.map((id) => {
    const item = resultMap[id];
    if (!item || typeof item !== 'object') return null;
    return {
      id,
      title:   item.title   || 'Sans titre',
      journal: item.source  || '',
      year:    (item.pubdate || '').slice(0, 4),
      authors: (item.authors ?? []).slice(0, 5).map((a) => a.name).join(', '),
      url:     'https://pubmed.ncbi.nlm.nih.gov/' + id + '/',
    };
  }).filter(Boolean);
}

// ── Traduction ────────────────────────────────────────────────────────────────

async function translate(text) {
  try {
    const data = await get('https://lingva.ml/api/v1/fr/en/' + encodeURIComponent(text));
    if (data?.translation) return data.translation;
  } catch { /* fallback */ }
  try {
    const data = await get(
      'https://api.mymemory.translated.net/get?langpair=fr|en&q=' + encodeURIComponent(text)
    );
    if (data?.responseData?.translatedText && data.responseStatus === 200)
      return data.responseData.translatedText;
  } catch { /* original */ }
  return text;
}

// ── DCI via RxNorm ────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the','of','in','and','or','for','use','with','during','after','before',
  'at','by','from','to','on','an','a','is','are','was','were','have','has',
  'management','treatment','therapy','patients','patient','adults','adult',
  'role','effect','effects','impact','study','review','analysis','using',
]);

async function findDCI(sentence) {
  const words = sentence.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));

  for (const word of words.slice(0, 6)) {
    try {
      const data1 = await get(
        'https://rxnav.nlm.nih.gov/REST/rxcui.json?name=' + encodeURIComponent(word) + '&search=2'
      );
      const rxcui = data1?.idGroup?.rxnormId?.[0];
      if (!rxcui) continue;

      const data2 = await get(
        'https://rxnav.nlm.nih.gov/REST/rxcui/' + rxcui + '/related.json?tty=IN'
      );
      const groups   = data2?.relatedGroup?.conceptGroup ?? [];
      const ingGroup = groups.find((g) => g.tty === 'IN' && g.conceptProperties?.length > 0);
      if (ingGroup) return { brand: word, dci: ingGroup.conceptProperties[0].name };
    } catch { continue; }
  }
  return null;
}

// ── Rendu résultats ───────────────────────────────────────────────────────────

function renderResults(results, pubmedQuery) {
  hideAll();

  resultsTitle.textContent = 'Résultats PubMed';
  resultsBadge.textContent = results.length + ' résultat' + (results.length !== 1 ? 's' : '');
  externalLink.href        = 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(pubmedQuery);
  externalLink.textContent = 'Voir tous les résultats sur PubMed →';

  resultsContainer.innerHTML = '';

  if (results.length === 0) {
    resultsContainer.innerHTML =
      '<p style="color:var(--muted);font-size:.9rem">Aucun résultat. Essayez d\'autres mots-clés ou retirez des filtres.</p>';
  } else {
    results.forEach((r) => resultsContainer.appendChild(buildCard(r)));
  }

  filterCard.hidden     = false;
  resultsSection.hidden = false;
}

function buildCard(r) {
  const card = document.createElement('div');
  card.className = 'result-item';

  const titleEl = document.createElement('div');
  titleEl.className = 'result-title';
  const a = document.createElement('a');
  a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.textContent = r.title;
  titleEl.appendChild(a);
  card.appendChild(titleEl);

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  [r.journal, r.year].filter(Boolean).forEach((label) => {
    const tag = document.createElement('span');
    tag.className = 'tag'; tag.textContent = label;
    meta.appendChild(tag);
  });
  if (meta.childNodes.length) card.appendChild(meta);

  if (r.authors) {
    const auth = document.createElement('p');
    auth.className = 'result-meta'; auth.textContent = r.authors;
    card.appendChild(auth);
  }

  const link = document.createElement('a');
  link.className = 'result-link'; link.href = r.url;
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.textContent = 'Lire sur PubMed →';
  card.appendChild(link);

  return card;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function showLoading(msg) {
  hideAll();
  loadingMsg.textContent = msg || 'Recherche en cours…';
  loadingEl.hidden = false;
}

function hideAll() {
  loadingEl.hidden      = true;
  errorBox.hidden       = true;
  resultsSection.hidden = true;
  filterCard.hidden     = true;
  synthesisCard.hidden  = true;
}

function hideInfoBoxes() {
  translationBox.hidden = true;
  conversionBox.hidden  = true;
  dciBox.hidden         = true;
  meshBox.hidden        = true;
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

function showMeSHTerms(terms) {
  meshTermsEl.innerHTML = '';
  terms.forEach((term) => {
    const tag = document.createElement('span');
    tag.className = 'mesh-tag'; tag.textContent = term;
    meshTermsEl.appendChild(tag);
  });
  meshBox.hidden = false;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function get(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('Réponse HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Délai dépassé (10 s).');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
