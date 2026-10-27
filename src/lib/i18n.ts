import type { LocaleCode } from '../types/settings';

export interface CoverCardStrings {
  forDelegate: string;
  bundledScorecards: (n: number | string) => string;
  checkedSignatures: string;
  incidentsCount: string;
  delegateInitials: string;
  forDataEntry: string;
  resultsEntered: string;
  scoretakerInitials: string;
  incidentsLogged: string;
  resultsChecked: string;
  // Subtitle of a 'per-round-card' cover, which covers a whole round instead of one group.
  allGroups: (n: number) => string;
  // Scheduled time, then write-ins for the actual time and scramble set.
  timing: (start?: string, end?: string) => string;
}

// One row per round, grouped by day and room. `groupsMade`/`scorecards` are tick-only and
// pre-ticked for round 1; `dataEntry`/`doubleCheck` take initials plus a tick; `takenBy` a name.
export interface CheckingSheetStrings {
  title: string;
  start: string;
  event: string;
  // Created on competitiongroups, not collected. Done even for a single-group round.
  groupsMade: string;
  // Scorecards produced - printed or hand-written - not collected.
  scorecards: string;
  dataEntry: string;
  doubleCheck: string;
  takenBy: string;
}

export interface ScheduleStrings {
  title: string;
  estimatedStart: string;
  estimatedEnd: string;
  event: string;
  actualStart: string;
  actualEnd: string;
  numberOfCompetitors: string;
  dayPrefix: string;
  attemptLabel: (n: number) => string;
  roundLabel: (n: number) => string;
  finalLabel: string;
}

export interface GroupOverviewStrings {
  title: string;
  competitors: string;
  scramblers: string;
  runners: string;
  judges: string;
  room: string;
}

export interface NametTagStrings {
  compete: string;
  scramble: string;
  judge: string;
  run: string;
  dutyGroup: (groupList: string) => string;
  qrSchedule: string;
  qrResults: string;
}

// Bolded values always end their line, so each prefix is stored without its value and the
// document appends it bold.
export interface FirstTimerSlipStrings {
  confirmIntro1: string;
  confirmIntro2: string;
  firstCompetition: string;
  preferredNamePrefix: string;
  genderPrefix: string;
  birthdatePrefix: string;
  citizenshipPrefix: string;
  parentalConsent: string;
  solveSingle: (event: string) => string;
  solveMultipleIntro: string;
  genderMale: string;
  genderFemale: string;
  genderOther: string;
}

export interface NametTagTitleStrings {
  delegate: (isFemale: boolean) => string;
  organizer: (isFemale: boolean) => string;
  newCompetitor: (isFemale: boolean) => string;
  competitor: (isFemale: boolean) => string;
  staff: (isFemale: boolean) => string;
}

export interface ScorecardStrings {
  scrambler: string;
  scramblerCheck: string;
  attempt: string;
  judge: string;
  competitor: string;
  resultPrefix: string;
  dnfSuffix: (limit: string) => string;
  cumulativeSuffix: (limit: string) => string;
  // Compact forms used in the 6-column (double-check) header where the result column is narrower.
  shortDnfSuffix: (limit: string) => string;
  shortCumulativeSuffix: (limit: string) => string;
  mbfSuffix: string;
  cutoffLine: (cutoff: string, mo3: boolean) => string;
  provisionalLine: string;
  newCompetitor: string;
  newCompetitorF: string;
  roundName: (n: number, total: number) => string;
  finalRound: string;
  tutorial: string;
  groupLabel: (gNum: string | number, total: number) => string;
  colorGroupLabel: (color: string, gNum: string | number, total: number) => string;
  blankGroupLabel: (total: number) => string;
  // Connector in "X of Y" labels, used to grey the trailing portion.
  ofConnector: string;
  stationLabel: (n: string) => string;
  cover: CoverCardStrings;
}

const EN: ScorecardStrings = {
  scrambler: 'Scrambler',
  scramblerCheck: 'Check',
  attempt: 'Attempt',
  judge: 'Judge',
  competitor: 'Competitor',
  resultPrefix: 'Result',
  dnfSuffix: (limit) => `(DNF if not under ${limit})`,
  cumulativeSuffix: (limit) => `(Cumulative Time Limit: ${limit})`,
  shortDnfSuffix: (limit) => `(DNF if <${limit})`,
  shortCumulativeSuffix: (limit) => `(cumul. <${limit})`,
  mbfSuffix: '(Limit: Reg. H1b)',
  cutoffLine: (cutoff, mo3) =>
    mo3
      ? `─── Continue if Attempt 1 is below ${cutoff} ───`
      : `─── Continue if Attempt 1 or 2 is below ${cutoff} ───`,
  provisionalLine: '─── Extra or Provisional Solve (Delegate Initials _______) ───',
  newCompetitor: 'New Competitor',
  newCompetitorF: 'New Competitor',
  roundName: (n, total) => `Round ${n} of ${total}`,
  finalRound: 'Final Round',
  tutorial: 'Tutorial',
  groupLabel: (gNum, total) => `Group ${gNum} of ${total}`,
  colorGroupLabel: (color, gNum, total) => `${color} ${gNum} of ${total}`,
  blankGroupLabel: (total) => `Group _ of ${total}`,
  ofConnector: 'of',
  stationLabel: (n) => `Station ${n}`,
  cover: {
    forDelegate: 'FOR DELEGATE',
    bundledScorecards: (n) => `1. Bundled all ${n} scorecards`,
    checkedSignatures: '2. Checked for missing signatures',
    incidentsCount: '3. Number of scorecards with incidents: _____',
    delegateInitials: 'Delegate Initials ______',
    forDataEntry: 'FOR DATA ENTRY',
    resultsEntered: '4. Results entered by Scoretaker',
    scoretakerInitials: 'Scoretaker Initials ______',
    incidentsLogged: '5. Incidents logged by Delegate',
    resultsChecked: '6. Results checked by Delegate',
    allGroups: (n) => (n === 1 ? 'Only 1 group' : `All ${n} groups`),
    timing: (s, e) => `${s && e ? `Planned ${s}-${e} · ` : ''}Actual _____-_____ · Set ____`,
  },
};

const FR: ScorecardStrings = {
  scrambler: 'Mélangeur',
  scramblerCheck: 'Vérif.',
  attempt: 'Essai',
  judge: 'Juge',
  competitor: 'Compétiteur',
  resultPrefix: 'Résultat',
  dnfSuffix: (limit) => `(DNF si n'est pas inférieur à ${limit})`,
  cumulativeSuffix: (limit) => `(Limite de Temps Cumul.: ${limit})`,
  shortDnfSuffix: (limit) => `(DNF si <${limit})`,
  shortCumulativeSuffix: (limit) => `(cumul. <${limit})`,
  mbfSuffix: '(Limite: Rég. H1b)',
  cutoffLine: (cutoff, mo3) =>
    mo3
      ? `─── Continuez si Essai 1 est inférieur à ${cutoff} ───`
      : `─── Continuez si Essai 1 ou 2 sont inférieurs à ${cutoff} ───`,
  provisionalLine: '─── Essai extra ou provisoire (Initiales du Délégué _______) ───',
  newCompetitor: 'Nouveau Compétiteur',
  newCompetitorF: 'Nouvelle Compétitrice',
  roundName: (n, total) => `Tour ${n} sur ${total}`,
  finalRound: 'Tour Final',
  tutorial: 'Tutoriel',
  groupLabel: (gNum, total) => `Groupe ${gNum} sur ${total}`,
  colorGroupLabel: (color, gNum, total) => `${color} ${gNum} sur ${total}`,
  blankGroupLabel: (total) => `Groupe _ sur ${total}`,
  ofConnector: 'sur',
  stationLabel: (n) => `Station ${n}`,
  cover: {
    forDelegate: 'POUR LE DÉLÉGUÉ',
    bundledScorecards: (n) => `1. Regrouper les ${n} feuilles`,
    checkedSignatures: '2. Vérifier les signatures manquantes',
    incidentsCount: '3. Nombre de feuilles avec incidents : _____',
    delegateInitials: 'Initiales du Délégué ______',
    forDataEntry: 'POUR LA SAISIE DES DONNÉES',
    resultsEntered: '4. Résultats entrés par le saisisseur de résultats',
    scoretakerInitials: 'Initiales du Saisisseur ______',
    incidentsLogged: '5. Incidents enregistrés par le Délégué',
    resultsChecked: '6. Résultats vérifiés par le Délégué',
    allGroups: (n) => (n === 1 ? 'Un seul groupe' : `Les ${n} groupes`),
    timing: (s, e) => `${s && e ? `Prévu ${s}-${e} · ` : ''}Réel _____-_____ · Set ____`,
  },
};

const ES: ScorecardStrings = {
  scrambler: 'Mezclador',
  scramblerCheck: 'Verif.',
  attempt: 'Intento',
  judge: 'Juez',
  competitor: 'Competidor',
  resultPrefix: 'Resultado',
  dnfSuffix: (limit) => `(DNF si no es inferior a ${limit})`,
  cumulativeSuffix: (limit) => `(Límite de tiempo acumulado: ${limit})`,
  shortDnfSuffix: (limit) => `(DNF si <${limit})`,
  shortCumulativeSuffix: (limit) => `(acum. <${limit})`,
  mbfSuffix: '(Límite: Reg. H1b)',
  cutoffLine: (cutoff, mo3) =>
    mo3
      ? `─── Continuar si el Intento 1 es inferior a ${cutoff} ───`
      : `─── Continuar si el Intento 1 o 2 es inferior a ${cutoff} ───`,
  provisionalLine: '─── Intento extra o provisional (Iniciales del Delegado _______) ───',
  newCompetitor: 'Nuevo Competidor',
  newCompetitorF: 'Nueva Competidora',
  roundName: (n, total) => `Ronda ${n} de ${total}`,
  finalRound: 'Ronda Final',
  tutorial: 'Tutorial',
  groupLabel: (gNum, total) => `Grupo ${gNum} de ${total}`,
  colorGroupLabel: (color, gNum, total) => `${color} ${gNum} de ${total}`,
  blankGroupLabel: (total) => `Grupo _ de ${total}`,
  ofConnector: 'de',
  stationLabel: (n) => `Estación ${n}`,
  cover: {
    forDelegate: 'PARA EL DELEGADO',
    bundledScorecards: (n) => `1. Agrupadas todas las ${n} hojas`,
    checkedSignatures: '2. Verificadas las firmas faltantes',
    incidentsCount: '3. Número de hojas con incidentes: _____',
    delegateInitials: 'Iniciales del Delegado ______',
    forDataEntry: 'PARA INGRESO DE DATOS',
    resultsEntered: '4. Resultados ingresados por el Digitador de Resultados',
    scoretakerInitials: 'Iniciales del Digitador ______',
    incidentsLogged: '5. Incidentes registrados por el Delegado',
    resultsChecked: '6. Resultados verificados por el Delegado',
    allGroups: (n) => (n === 1 ? 'Solo un grupo' : `Los ${n} grupos`),
    timing: (s, e) => `${s && e ? `Previsto ${s}-${e} · ` : ''}Real _____-_____ · Set ____`,
  },
};

const PT: ScorecardStrings = {
  // The full "Embaralhador" is 34.5pt at 5.5pt Helvetica; the column holds 31.1pt. This is
  // the longest form Pedro accepts that fits.
  scrambler: 'Embaralha.',
  scramblerCheck: 'Verif.',
  attempt: 'Tentativa',
  judge: 'Juiz',
  competitor: 'Competidor',
  resultPrefix: 'Resultado',
  dnfSuffix: (limit) => `(DNF se não for inferior a ${limit})`,
  cumulativeSuffix: (limit) => `(Limite de tempo acumulado: ${limit})`,
  shortDnfSuffix: (limit) => `(DNF se <${limit})`,
  shortCumulativeSuffix: (limit) => `(acum. <${limit})`,
  mbfSuffix: '(Limite: Art. H1b)',
  cutoffLine: (cutoff, mo3) =>
    mo3
      ? `─── Continue se a Tentativa 1 for inferior a ${cutoff} ───`
      : `─── Continue se a Tentativa 1 ou 2 for inferior a ${cutoff} ───`,
  provisionalLine: '─── Tentativa extra ou provisória (Iniciais do Delegado _______) ───',
  newCompetitor: 'Novo Competidor',
  newCompetitorF: 'Nova Competidora',
  roundName: (n, total) => `Rodada ${n} de ${total}`,
  finalRound: 'Rodada Final',
  tutorial: 'Tutorial',
  groupLabel: (gNum, total) => `Grupo ${gNum} de ${total}`,
  colorGroupLabel: (color, gNum, total) => `${color} ${gNum} de ${total}`,
  blankGroupLabel: (total) => `Grupo _ de ${total}`,
  ofConnector: 'de',
  stationLabel: (n) => `Estação ${n}`,
  cover: {
    forDelegate: 'PARA O DELEGADO',
    bundledScorecards: (n) => `1. Todas as ${n} súmulas agrupadas`,
    checkedSignatures: '2. Verificadas as assinaturas faltantes',
    incidentsCount: '3. Número de súmulas com incidentes: _____',
    delegateInitials: 'Iniciais do Delegado ______',
    forDataEntry: 'PARA A EQUIPE DE RESULTADOS',
    resultsEntered: '4. Resultados inseridos pelo Anotador de Resultados',
    scoretakerInitials: 'Iniciais do Anotador ______',
    incidentsLogged: '5. Incidentes registrados pelo Delegado',
    resultsChecked: '6. Resultados verificados pelo Delegado',
    allGroups: (n) => (n === 1 ? 'O único grupo' : `Os ${n} grupos`),
    timing: (s, e) => `${s && e ? `Previsto ${s}-${e} · ` : ''}Real _____-_____ · Set ____`,
  },
};

/**
 * Column headers and the cut-off/provisional lines stack both languages; everything else
 * stays primary-only. The single place defining which fields are bilingual.
 */
function mergeScorecardStrings(primary: ScorecardStrings, secondary: ScorecardStrings): ScorecardStrings {
  return {
    scrambler: `${primary.scrambler}\n${secondary.scrambler}`,
    scramblerCheck: `${primary.scramblerCheck}\n${secondary.scramblerCheck}`,
    attempt: `${primary.attempt}\n${secondary.attempt}`,
    judge: `${primary.judge}\n${secondary.judge}`,
    competitor: `${primary.competitor}\n${secondary.competitor}`,
    resultPrefix: `${primary.resultPrefix}\n${secondary.resultPrefix}`,
    dnfSuffix: (limit) => `${primary.dnfSuffix(limit)}\n${secondary.dnfSuffix(limit)}`,
    cumulativeSuffix: (limit) => `${primary.cumulativeSuffix(limit)}\n${secondary.cumulativeSuffix(limit)}`,
    shortDnfSuffix: (limit) => `${primary.shortDnfSuffix(limit)}\n${secondary.shortDnfSuffix(limit)}`,
    shortCumulativeSuffix: (limit) => `${primary.shortCumulativeSuffix(limit)}\n${secondary.shortCumulativeSuffix(limit)}`,
    mbfSuffix: primary.mbfSuffix,
    cutoffLine: (cutoff, mo3) => `${primary.cutoffLine(cutoff, mo3)}\n${secondary.cutoffLine(cutoff, mo3)}`,
    provisionalLine: `${primary.provisionalLine}\n${secondary.provisionalLine}`,
    newCompetitor: primary.newCompetitor,
    newCompetitorF: primary.newCompetitorF,
    roundName: (n, total) => `${primary.roundName(n, total)}`,
    finalRound: primary.finalRound,
    tutorial: primary.tutorial,
    groupLabel: (gNum, total) => primary.groupLabel(gNum, total),
    colorGroupLabel: (color, gNum, total) => primary.colorGroupLabel(color, gNum, total),
    blankGroupLabel: (total) => primary.blankGroupLabel(total),
    ofConnector: primary.ofConnector,
    stationLabel: (n) => primary.stationLabel(n),
    cover: primary.cover,
  };
}

/** `secondary` null, undefined or equal to primary means single language. */
export function getStrings(language: LocaleCode, secondary?: LocaleCode | null): ScorecardStrings {
  const primary = LOCALES[language].scorecard;
  if (!secondary || secondary === language) return primary;
  return mergeScorecardStrings(primary, LOCALES[secondary].scorecard);
}

/**
 * Splits "X of Y" into the normal `head` and the greyed trailing ` of Y`. Splits on the LAST
 * connector, so stage names ("Bleu 1 de 2") survive. `tail: null` when there is none.
 */
export function splitLabelTotal(
  label: string,
  connector: string,
): { head: string; tail: string | null } {
  const marker = ` ${connector} `;
  const idx = label.lastIndexOf(marker);
  if (idx === -1) return { head: label, tail: null };
  return { head: label.slice(0, idx), tail: label.slice(idx) };
}

const SCHEDULE_EN: ScheduleStrings = {
  title: '- Schedule Tracker',
  estimatedStart: 'Estimated\nStart Time',
  estimatedEnd: 'Estimated\nEnd Time',
  event: 'Event',
  actualStart: 'Actual\nStart Time',
  actualEnd: 'Actual\nEnd Time',
  numberOfCompetitors: 'Number of\nCompetitors',
  dayPrefix: 'Day',
  attemptLabel: (n) => `Attempt ${n}`,
  roundLabel: (n) => `Round ${n}`,
  finalLabel: 'Final',
};

const SCHEDULE_FR: ScheduleStrings = {
  title: '- Suivi de l\'horaire',
  estimatedStart: 'Heure de\ndébut estimée',
  estimatedEnd: 'Heure de\nfin estimée',
  event: 'Épreuve',
  actualStart: 'Heure de\ndébut réelle',
  actualEnd: 'Heure de\nfin réelle',
  numberOfCompetitors: 'Nombre de\ncompétiteurs',
  dayPrefix: 'Jour',
  attemptLabel: (n) => `Essai ${n}`,
  roundLabel: (n) => `Tour ${n}`,
  finalLabel: 'Final',
};

const SCHEDULE_ES: ScheduleStrings = {
  title: '- Seguimiento del Horario',
  estimatedStart: 'Hora de\ninicio estimada',
  estimatedEnd: 'Hora de\nfin estimada',
  event: 'Evento',
  actualStart: 'Hora de\ninicio real',
  actualEnd: 'Hora de\nfin real',
  numberOfCompetitors: 'Número de\ncompetidores',
  dayPrefix: 'Día',
  attemptLabel: (n) => `Intento ${n}`,
  roundLabel: (n) => `Ronda ${n}`,
  finalLabel: 'Final',
};

const SCHEDULE_PT: ScheduleStrings = {
  title: '- Acompanhamento de Horário',
  estimatedStart: 'Horário de\nInício Estimado',
  estimatedEnd: 'Horário de\nTérmino Estimado',
  event: 'Evento',
  actualStart: 'Horário de\nInício Real',
  actualEnd: 'Horário de\nTérmino Real',
  numberOfCompetitors: 'Número de\nCompetidores',
  dayPrefix: 'Dia',
  attemptLabel: (n) => `Tentativa ${n}`,
  roundLabel: (n) => `Rodada ${n}`,
  finalLabel: 'Final',
};

export function getScheduleStrings(language: LocaleCode): ScheduleStrings {
  return LOCALES[language].schedule;
}

const CHECKING_EN: CheckingSheetStrings = {
  title: '- Round Checklist',
  start: 'Start\nTime',
  event: 'Event',
  groupsMade: 'Groups\ncreated',
  scorecards: 'Scorecards\nready',
  dataEntry: 'Data entry\n(initials)',
  doubleCheck: 'Double-check\n(initials)',
  takenBy: 'Scorecards\ntaken by',
};

const CHECKING_FR: CheckingSheetStrings = {
  title: '- Liste de vérification',
  start: 'Heure de\ndébut',
  event: 'Épreuve',
  groupsMade: 'Groupes\ncréés',
  scorecards: 'Feuilles\nprêtes',
  dataEntry: 'Saisie\n(initiales)',
  doubleCheck: 'Double vérif.\n(initiales)',
  takenBy: 'Feuilles\nreprises par',
};

const CHECKING_ES: CheckingSheetStrings = {
  title: '- Lista de Verificación',
  start: 'Hora de\ninicio',
  event: 'Evento',
  groupsMade: 'Grupos\ncreados',
  scorecards: 'Hojas\nlistas',
  dataEntry: 'Ingreso\n(iniciales)',
  doubleCheck: 'Doble verif.\n(iniciales)',
  takenBy: 'Hojas\nretiradas por',
};

const CHECKING_PT: CheckingSheetStrings = {
  title: '- Lista de Verificação',
  start: 'Horário de\nInício',
  event: 'Evento',
  groupsMade: 'Grupos\ncriados',
  scorecards: 'Folhas\nprontas',
  dataEntry: 'Entrada\n(iniciais)',
  doubleCheck: 'Dupla verif.\n(iniciais)',
  takenBy: 'Folhas\nlevadas por',
};

export function getCheckingSheetStrings(language: LocaleCode): CheckingSheetStrings {
  return LOCALES[language].checking;
}

// Column headings print with their count appended ("Competitors (14)"), so they stay nouns.
const GROUP_OVERVIEW_EN: GroupOverviewStrings = {
  title: '- Group Overview',
  competitors: 'Competitors',
  scramblers: 'Scramblers',
  runners: 'Runners',
  judges: 'Judges',
  room: 'Room',
};

const GROUP_OVERVIEW_FR: GroupOverviewStrings = {
  title: '- Aperçu des groupes',
  competitors: 'Compétiteurs',
  scramblers: 'Mélangeurs',
  runners: 'Coureurs',
  judges: 'Juges',
  room: 'Salle',
};

const GROUP_OVERVIEW_ES: GroupOverviewStrings = {
  title: '- Resumen de grupos',
  competitors: 'Competidores',
  scramblers: 'Mezcladores',
  runners: 'Corredores',
  judges: 'Jueces',
  room: 'Sala',
};

const GROUP_OVERVIEW_PT: GroupOverviewStrings = {
  title: '- Visão geral dos grupos',
  competitors: 'Competidores',
  scramblers: 'Misturadores',
  runners: 'Corredores',
  judges: 'Juízes',
  room: 'Sala',
};

export function getGroupOverviewStrings(language: LocaleCode): GroupOverviewStrings {
  return LOCALES[language].groupOverview;
}

const NAMETAG_EN: NametTagStrings = {
  compete: 'Compete:',
  scramble: 'Scramble:',
  judge: 'Judge:',
  run: 'Run:',
  dutyGroup: (g) => `Group ${g}`,
  qrSchedule: 'Schedule',
  qrResults: 'Results',
};

const NAMETAG_FR: NametTagStrings = {
  compete: 'Concourir:',
  scramble: 'Mélanger:',
  judge: 'Juger:',
  run: 'Courir:',
  dutyGroup: (g) => `Groupe ${g}`,
  qrSchedule: 'Horaire',
  qrResults: 'Résultats',
};

const NAMETAG_ES: NametTagStrings = {
  compete: 'Competir:',
  scramble: 'Mezclar:',
  judge: 'Juzgar:',
  run: 'Correr:',
  dutyGroup: (g) => `Grupo ${g}`,
  qrSchedule: 'Horario',
  qrResults: 'Resultados',
};

const NAMETAG_PT: NametTagStrings = {
  compete: 'Competir:',
  scramble: 'Misturar:',
  judge: 'Julgar:',
  run: 'Correr:',
  dutyGroup: (g) => `Grupo ${g}`,
  qrSchedule: 'Cronograma',
  qrResults: 'Resultados',
};

export function getNametTagStrings(language: LocaleCode): NametTagStrings {
  return LOCALES[language].nametag;
}

const FIRST_TIMER_EN: FirstTimerSlipStrings = {
  confirmIntro1: 'Please check off the boxes to confirm everything is correct.',
  confirmIntro2: 'If anything is incorrect, please let us know.',
  firstCompetition: 'This is my first WCA competition',
  preferredNamePrefix: 'My preferred name is',
  genderPrefix: 'My gender identity is',
  birthdatePrefix: 'My birthdate is',
  citizenshipPrefix: 'I hold citizenship in',
  parentalConsent: 'I have permission from a parent/guardian/caregiver to compete',
  solveSingle: (e) => `I can solve the ${e}`,
  solveMultipleIntro: 'I can solve all these puzzles/events:',
  genderMale: 'male',
  genderFemale: 'female',
  genderOther: 'non-binary or undisclosed',
};

const FIRST_TIMER_FR: FirstTimerSlipStrings = {
  confirmIntro1: 'Veuillez cocher les cases pour confirmer que tout est exact.',
  confirmIntro2: 'Si quelque chose est incorrect, veuillez nous en informer.',
  firstCompetition: "C'est ma première compétition WCA",
  preferredNamePrefix: 'Mon nom préféré est',
  genderPrefix: 'Mon identité de genre est',
  birthdatePrefix: 'Ma date de naissance est',
  citizenshipPrefix: 'Mon pays de citoyenneté est',
  parentalConsent: "J'ai la permission d'un parent/tuteur/responsable pour participer",
  solveSingle: (e) => `Je peux résoudre le ${e}`,
  solveMultipleIntro: 'Je peux résoudre tous ces casse-têtes/épreuves :',
  genderMale: 'masculin',
  genderFemale: 'féminin',
  genderOther: 'non-binaire ou non divulgué',
};

const FIRST_TIMER_ES: FirstTimerSlipStrings = {
  confirmIntro1: 'Marque las casillas para confirmar que todo es correcto.',
  confirmIntro2: 'Si algo es incorrecto, háganoslo saber.',
  firstCompetition: 'Esta es mi primera competición de la WCA',
  preferredNamePrefix: 'Mi nombre preferido es',
  genderPrefix: 'Mi identidad de género es',
  birthdatePrefix: 'Mi fecha de nacimiento es',
  citizenshipPrefix: 'Mi país de ciudadanía es',
  parentalConsent: 'Tengo permiso de un padre/madre/tutor para competir',
  solveSingle: (e) => `Sé resolver el ${e}`,
  solveMultipleIntro: 'Sé resolver todos estos rompecabezas/eventos:',
  genderMale: 'masculino',
  genderFemale: 'femenino',
  genderOther: 'no binario o no revelado',
};

const FIRST_TIMER_PT: FirstTimerSlipStrings = {
  confirmIntro1: 'Marque as caixas para confirmar que está tudo correto.',
  confirmIntro2: 'Se algo estiver incorreto, avise-nos.',
  firstCompetition: 'Esta é a minha primeira competição da WCA',
  preferredNamePrefix: 'Meu nome preferido é',
  genderPrefix: 'Minha identidade de gênero é',
  birthdatePrefix: 'Minha data de nascimento é',
  citizenshipPrefix: 'Meu país de cidadania é',
  parentalConsent: 'Tenho permissão de um pai/mãe/responsável para competir',
  solveSingle: (e) => `Sei resolver o ${e}`,
  solveMultipleIntro: 'Sei resolver todos estes quebra-cabeças/eventos:',
  genderMale: 'masculino',
  genderFemale: 'feminino',
  genderOther: 'não binário ou não divulgado',
};

export function getFirstTimerSlipStrings(language: LocaleCode): FirstTimerSlipStrings {
  return LOCALES[language].firstTimer;
}

const NAMETAG_TITLE_EN: NametTagTitleStrings = {
  delegate:     () => 'DELEGATE',
  organizer:    () => 'ORGANIZER',
  newCompetitor: () => 'NEW COMPETITOR',
  competitor:   () => 'COMPETITOR',
  staff:        () => 'STAFF',
};

const NAMETAG_TITLE_FR: NametTagTitleStrings = {
  delegate:     (f) => f ? 'DÉLÉGUÉE' : 'DÉLÉGUÉ',
  organizer:    (f) => f ? 'ORGANISATRICE' : 'ORGANISATEUR',
  newCompetitor: (f) => f ? 'NOUVELLE COMPÉTITRICE' : 'NOUVEAU COMPÉTITEUR',
  competitor:   (f) => f ? 'COMPÉTITRICE' : 'COMPÉTITEUR',
  staff:        () => 'STAFF',
};

const NAMETAG_TITLE_ES: NametTagTitleStrings = {
  delegate:     (f) => f ? 'DELEGADA' : 'DELEGADO',
  organizer:    (f) => f ? 'ORGANIZADORA' : 'ORGANIZADOR',
  newCompetitor: (f) => f ? 'NUEVA COMPETIDORA' : 'NUEVO COMPETIDOR',
  competitor:   (f) => f ? 'COMPETIDORA' : 'COMPETIDOR',
  staff:        () => 'STAFF',
};

const NAMETAG_TITLE_PT: NametTagTitleStrings = {
  delegate:     (f) => f ? 'DELEGADA' : 'DELEGADO',
  organizer:    (f) => f ? 'ORGANIZADORA' : 'ORGANIZADOR',
  newCompetitor: (f) => f ? 'NOVA COMPETIDORA' : 'NOVO COMPETIDOR',
  competitor:   (f) => f ? 'COMPETIDORA' : 'COMPETIDOR',
  staff:        () => 'STAFF',
};

/** Front panel primary, back panel secondary when set: single-language means both match. */
export function getNametTagTitleStrings(
  language: LocaleCode,
  secondary?: LocaleCode | null,
): { front: NametTagTitleStrings; back: NametTagTitleStrings } {
  return {
    front: LOCALES[language].title,
    back: LOCALES[secondary ?? language].title,
  };
}

// Short event names for nametag duty labels. Puzzle names are brand names, so only 3x3x3
// One-Handed and FTO differ: a shared base plus per-locale overrides, not four near-copies.
const SHORT_NAMETAG_NAMES_BASE: Record<string, string> = {
  '333': '3x3x3', '222': '2x2x2', '444': '4x4x4', '555': '5x5x5',
  '666': '6x6x6', '777': '7x7x7', '333bf': '3x3x3 BLD', '333fm': 'FMC',
  '333oh': 'One-Hand', 'clock': 'Clock', 'minx': 'Megaminx', 'pyram': 'Pyraminx',
  'skewb': 'Skewb', 'sq1': 'Square-1', 'fto': 'FTO', '444bf': '4x4x4 BLD', '555bf': '5x5x5 BLD',
  '333mbf': 'Multi-BLD',
};

const shortNames = (overrides: Record<string, string> = {}): Record<string, string> =>
  ({ ...SHORT_NAMETAG_NAMES_BASE, ...overrides });

const SHORT_NAMETAG_NAMES_EN = shortNames();
const SHORT_NAMETAG_NAMES_FR = shortNames({ '333oh': 'À une main', 'fto': 'Octaminx' });
const SHORT_NAMETAG_NAMES_ES = shortNames({ '333oh': 'Una mano' });
const SHORT_NAMETAG_NAMES_PT = shortNames({ '333oh': 'Uma Mão' });

export function getShortNametTagNames(language: LocaleCode): Record<string, string> {
  return LOCALES[language].shortNames;
}

export const EVENT_NAMES_EN: Record<string, string> = {
  '333': '3x3x3 Cube', '222': '2x2x2 Cube', '444': '4x4x4 Cube',
  '555': '5x5x5 Cube', '666': '6x6x6 Cube', '777': '7x7x7 Cube',
  '333bf': '3x3x3 Blindfolded', '333fm': 'FMC', '333oh': '3x3x3 One-Handed',
  'clock': 'Clock', 'minx': 'Megaminx', 'pyram': 'Pyraminx',
  'skewb': 'Skewb', 'sq1': 'Square-1', 'fto': 'FTO', '444bf': '4x4x4 Blindfolded',
  '555bf': '5x5x5 Blindfolded', '333mbf': '3x3x3 Multi-Blind',
};

const EVENT_NAMES_FR: Record<string, string> = {
  '333': 'Cube 3x3x3', '222': 'Cube 2x2x2', '444': 'Cube 4x4x4',
  '555': 'Cube 5x5x5', '666': 'Cube 6x6x6', '777': 'Cube 7x7x7',
  '333bf': "3x3x3 à L'aveugle", '333fm': 'FMC', '333oh': '3x3x3 à Une Main',
  'clock': 'Clock', 'minx': 'Megaminx', 'pyram': 'Pyraminx',
  'skewb': 'Skewb', 'sq1': 'Square-1', 'fto': 'Octaminx', '444bf': "4x4x4 à L'aveugle",
  '555bf': "5x5x5 à L'aveugle", '333mbf': 'Multi-BLD',
};

const EVENT_NAMES_ES: Record<string, string> = {
  '333': 'Cubo 3x3x3', '222': 'Cubo 2x2x2', '444': 'Cubo 4x4x4',
  '555': 'Cubo 5x5x5', '666': 'Cubo 6x6x6', '777': 'Cubo 7x7x7',
  '333bf': '3x3x3 A Ciegas', '333fm': 'FMC', '333oh': '3x3x3 Una Mano',
  'clock': 'Clock', 'minx': 'Megaminx', 'pyram': 'Pyraminx',
  'skewb': 'Skewb', 'sq1': 'Square-1', 'fto': 'FTO', '444bf': '4x4x4 A Ciegas',
  '555bf': '5x5x5 A Ciegas', '333mbf': '3x3x3 Multi-BLD',
};

const EVENT_NAMES_PT: Record<string, string> = {
  '333': 'Cubo 3x3x3', '222': 'Cubo 2x2x2', '444': 'Cubo 4x4x4',
  '555': 'Cubo 5x5x5', '666': 'Cubo 6x6x6', '777': 'Cubo 7x7x7',
  '333bf': '3x3x3 Às Cegas', '333fm': 'FMC', '333oh': '3x3x3 Uma Mão',
  'clock': 'Clock', 'minx': 'Megaminx', 'pyram': 'Pyraminx',
  'skewb': 'Skewb', 'sq1': 'Square-1', 'fto': 'FTO', '444bf': '4x4x4 Às Cegas',
  '555bf': '5x5x5 Às Cegas', '333mbf': '3x3x3 Multi-BLD',
};

export function getEventName(eventId: string, language: LocaleCode): string {
  return LOCALES[language].eventNames[eventId] ?? eventId;
}

// The generate page's progress bar. In the registry below so i18n.test.ts's parity loop
// covers them; otherwise a missing locale silently falls back to English at runtime.
export interface WorkerStrings {
  starting: string;
  rendering: (label: string) => string;
  done: (label: string) => string;
  creatingZip: string;
  finalizing: string;
  noEntries: string;
}

const WORKER_EN: WorkerStrings = {
  starting: 'Starting…',
  rendering: (label) => `Rendering ${label}…`,
  done: (label) => `${label} done`,
  creatingZip: 'Creating ZIP…',
  finalizing: 'Finalizing…',
  noEntries: 'No entries to render.',
};

const WORKER_FR: WorkerStrings = {
  starting: 'Démarrage…',
  rendering: (label) => `Rendu de ${label}…`,
  done: (label) => `${label} terminé`,
  creatingZip: 'Création du ZIP…',
  finalizing: 'Finalisation…',
  noEntries: 'Aucune feuille à générer.',
};

const WORKER_ES: WorkerStrings = {
  starting: 'Iniciando…',
  rendering: (label) => `Renderizando ${label}…`,
  done: (label) => `${label} listo`,
  creatingZip: 'Creando ZIP…',
  finalizing: 'Finalizando…',
  noEntries: 'Sin hojas que generar.',
};

const WORKER_PT: WorkerStrings = {
  starting: 'Iniciando…',
  rendering: (label) => `Renderizando ${label}…`,
  done: (label) => `${label} concluído`,
  creatingZip: 'Criando ZIP…',
  finalizing: 'Finalizando…',
  noEntries: 'Nenhuma folha para gerar.',
};

export function getWorkerStrings(language: LocaleCode): WorkerStrings {
  return LOCALES[language].worker;
}

// Adding a language: its string objects above, one entry here, and a UI JSON plus registry
// entry in src/i18n/index.ts. No getter or merge logic needs touching.
interface LocaleBundle {
  scorecard: ScorecardStrings;
  schedule: ScheduleStrings;
  checking: CheckingSheetStrings;
  groupOverview: GroupOverviewStrings;
  nametag: NametTagStrings;
  firstTimer: FirstTimerSlipStrings;
  title: NametTagTitleStrings;
  shortNames: Record<string, string>;
  eventNames: Record<string, string>;
  worker: WorkerStrings;
}

const LOCALES: Record<LocaleCode, LocaleBundle> = {
  en: { scorecard: EN, schedule: SCHEDULE_EN, checking: CHECKING_EN, groupOverview: GROUP_OVERVIEW_EN, nametag: NAMETAG_EN, firstTimer: FIRST_TIMER_EN, title: NAMETAG_TITLE_EN, shortNames: SHORT_NAMETAG_NAMES_EN, eventNames: EVENT_NAMES_EN, worker: WORKER_EN },
  fr: { scorecard: FR, schedule: SCHEDULE_FR, checking: CHECKING_FR, groupOverview: GROUP_OVERVIEW_FR, nametag: NAMETAG_FR, firstTimer: FIRST_TIMER_FR, title: NAMETAG_TITLE_FR, shortNames: SHORT_NAMETAG_NAMES_FR, eventNames: EVENT_NAMES_FR, worker: WORKER_FR },
  es: { scorecard: ES, schedule: SCHEDULE_ES, checking: CHECKING_ES, groupOverview: GROUP_OVERVIEW_ES, nametag: NAMETAG_ES, firstTimer: FIRST_TIMER_ES, title: NAMETAG_TITLE_ES, shortNames: SHORT_NAMETAG_NAMES_ES, eventNames: EVENT_NAMES_ES, worker: WORKER_ES },
  pt: { scorecard: PT, schedule: SCHEDULE_PT, checking: CHECKING_PT, groupOverview: GROUP_OVERVIEW_PT, nametag: NAMETAG_PT, firstTimer: FIRST_TIMER_PT, title: NAMETAG_TITLE_PT, shortNames: SHORT_NAMETAG_NAMES_PT, eventNames: EVENT_NAMES_PT, worker: WORKER_PT },
};
