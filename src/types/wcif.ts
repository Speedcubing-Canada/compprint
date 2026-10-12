export type EventId =
  | '333' | '222' | '444' | '555' | '666' | '777'
  | '333bf' | '333fm' | '333oh' | 'clock' | 'minx'
  | 'pyram' | 'skewb' | 'sq1' | 'fto' | '444bf' | '555bf' | '333mbf';

export type RoundFormat = 'a' | 'm' | '1' | '2' | '3' | '5' | 'h';

export interface TimeLimit {
  centiseconds: number;
  cumulativeRoundIds: string[];
}

export interface Cutoff {
  numberOfAttempts: number;
  attemptResult: number;
}

export interface ResultCondition {
  type: 'ranking' | 'percent' | 'resultAchieved';
  scope: 'single' | 'average';
  value: number | null;
}

export type ParticipationSource =
  | { type: 'registrations' }
  | { type: 'round'; roundId: string; resultCondition: ResultCondition }
  | { type: 'linkedRounds'; roundIds: string[]; resultCondition: ResultCondition };

export interface ParticipationRuleset {
  // Null only for competitions from 2021 and earlier.
  participationSource: ParticipationSource | null;
  reservedPlaces: { nationalities: string[]; count: number } | null;
}

export interface Round {
  id: string;
  format: RoundFormat;
  timeLimit: TimeLimit | null;
  cutoff: Cutoff | null;
  linkedRounds?: string[] | null;
  participationRuleset: ParticipationRuleset | null;
  scrambleSetCount: number;
  results: unknown[];
}

export interface Event {
  id: EventId;
  rounds: Round[];
  qualification: unknown | null;
}

export interface Assignment {
  activityId: number;
  stationNumber: number | null;
  assignmentCode: 'competitor' | 'staff-scrambler' | 'staff-judge' | 'staff-runner' | 'staff-dataentry';
}

export interface PersonalBest {
  eventId: EventId;
  value: number;
  worldRanking: number;
  continentalRanking: number;
  nationalRanking: number;
  type: 'single' | 'average';
}

export interface Registration {
  wcaRegistrationId: number;
  eventIds: EventId[];
  status: 'accepted' | 'pending' | 'deleted';
  isCompeting: boolean;
}

export interface Person {
  registrantId: number;
  name: string;
  wcaUserId: number;
  wcaId: string | null;
  countryIso2: string;
  gender: 'm' | 'f' | 'o';
  // ISO date (YYYY-MM-DD). Only present in the WCIF when the authenticated user
  // can manage the competition (delegate/organizer); absent otherwise.
  birthdate?: string | null;
  registration: Registration | null;
  avatar: { url: string; thumbUrl: string } | null;
  roles: string[];
  assignments: Assignment[];
  personalBests: PersonalBest[];
}

export interface ChildActivity {
  id: number;
  name: string;
  activityCode: string;
  startTime: string;
  endTime: string;
  childActivities: ChildActivity[];
  scrambleSets: unknown[];
}

export interface Activity {
  id: number;
  name: string;
  activityCode: string;
  startTime: string;
  endTime: string;
  childActivities: ChildActivity[];
  scrambleSets: unknown[];
}

export interface Room {
  id: number;
  name: string;
  color: string;
  activities: Activity[];
}

export interface Venue {
  id: number;
  name: string;
  latitudeMicrodegrees: number;
  longitudeMicrodegrees: number;
  countryIso2: string;
  timezone: string;
  rooms: Room[];
}

export interface Schedule {
  startDate: string;
  numberOfDays: number;
  venues: Venue[];
}

export interface WCIF {
  formatVersion: string;
  id: string;
  name: string;
  shortName: string;
  persons: Person[];
  events: Event[];
  schedule: Schedule;
  competitorLimit: number | null;
}

export interface WCACompetition {
  id: string;
  name: string;
  city: string;
  country_iso2: string;
  start_date: string;
  end_date: string;
  announced_at: string;
  registration_open: string;
  registration_close: string;
  competitor_limit: number | null;
  website: string;
}
