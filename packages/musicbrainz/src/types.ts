/**
 * MusicBrainz WS/2 JSON shapes (fmt=json). Keys mirror the API, hyphens and all.
 * Only the fields Quiztape reads are typed; everything else is passed through.
 */

export type ArtistType = 'Person' | 'Group' | 'Orchestra' | 'Choir' | 'Character' | 'Other';
export type ReleaseGroupPrimaryType = 'Album' | 'Single' | 'EP' | 'Broadcast' | 'Other';
export type ReleaseGroupSecondaryType =
  | 'Compilation'
  | 'Soundtrack'
  | 'Spokenword'
  | 'Interview'
  | 'Audiobook'
  | 'Audio drama'
  | 'Live'
  | 'Remix'
  | 'DJ-mix'
  | 'Mixtape/Street'
  | 'Demo'
  | 'Field recording';
export type ReleaseStatus = 'Official' | 'Promotion' | 'Bootleg' | 'Pseudo-Release' | 'Withdrawn' | 'Cancelled';

export interface LifeSpan {
  begin: string | null;
  end: string | null;
  ended: boolean;
}

export interface Area {
  id: string;
  name: string;
  'sort-name': string;
  type?: string | null;
  'iso-3166-1-codes'?: string[];
}

export interface Alias {
  name: string;
  'sort-name': string;
  type: string | null;
  primary: boolean | null;
  locale: string | null;
  begin: string | null;
  end: string | null;
  ended: boolean;
}

export interface Tag {
  name: string;
  count: number;
}

export interface Url {
  id: string;
  resource: string;
}

/**
 * Artist-artist relationships (inc=artist-rels). For 'member of band' the
 * relationship lives on both artists: on the group it is direction 'backward'
 * pointing at the person, on the person it is 'forward' pointing at the group.
 */
export interface Relation {
  type: string;
  'type-id': string;
  direction: 'forward' | 'backward';
  'target-type': string;
  begin: string | null;
  end: string | null;
  ended: boolean;
  attributes: string[];
  'attribute-values'?: Record<string, string>;
  'source-credit'?: string;
  'target-credit'?: string;
  artist?: Artist;
  url?: Url;
  label?: Label;
  recording?: Recording;
  release?: Release;
  release_group?: ReleaseGroup;
  work?: Work;
}

export interface Artist {
  id: string;
  name: string;
  'sort-name': string;
  type: ArtistType | null;
  'type-id'?: string | null;
  country: string | null;
  disambiguation: string;
  gender?: string | null;
  area?: Area | null;
  'begin-area'?: Area | null;
  'end-area'?: Area | null;
  'life-span'?: LifeSpan;
  isnis?: string[];
  aliases?: Alias[];
  tags?: Tag[];
  relations?: Relation[];
  'release-groups'?: ReleaseGroup[];
  /** Only on search results: 0-100 match quality. */
  score?: number;
}

export interface ArtistCredit {
  name: string;
  joinphrase: string;
  artist: Artist;
}

export interface ReleaseGroup {
  id: string;
  title: string;
  'primary-type': ReleaseGroupPrimaryType | null;
  'primary-type-id'?: string | null;
  'secondary-types': ReleaseGroupSecondaryType[];
  'secondary-type-ids'?: string[];
  /** YYYY, YYYY-MM or YYYY-MM-DD; empty string when unknown. */
  'first-release-date': string;
  disambiguation: string;
  'artist-credit'?: ArtistCredit[];
  releases?: Release[];
  relations?: Relation[];
}

export interface Label {
  id: string;
  name: string;
  'sort-name': string;
  type: string | null;
  'label-code': number | null;
  disambiguation: string;
}

export interface LabelInfo {
  'catalog-number': string | null;
  label: Label | null;
}

export interface ReleaseEvent {
  date: string;
  area: Area | null;
}

export interface Recording {
  id: string;
  title: string;
  /** Milliseconds; null when unknown. */
  length: number | null;
  disambiguation: string;
  video: boolean;
  'first-release-date'?: string;
  isrcs?: string[];
  'artist-credit'?: ArtistCredit[];
  relations?: Relation[];
  releases?: Release[];
}

export interface Track {
  id: string;
  position: number;
  number: string;
  title: string;
  length: number | null;
  recording: Recording;
  'artist-credit'?: ArtistCredit[];
}

export interface Medium {
  position: number;
  title: string;
  format: string | null;
  'format-id'?: string | null;
  'track-count': number;
  'track-offset'?: number;
  tracks?: Track[];
}

export interface Release {
  id: string;
  title: string;
  status: ReleaseStatus | null;
  'status-id'?: string | null;
  date: string;
  country: string | null;
  disambiguation: string;
  barcode?: string | null;
  packaging?: string | null;
  quality?: string;
  'text-representation'?: { language: string | null; script: string | null };
  'release-events'?: ReleaseEvent[];
  'release-group'?: ReleaseGroup;
  'artist-credit'?: ArtistCredit[];
  'label-info'?: LabelInfo[];
  media?: Medium[];
  relations?: Relation[];
}

export interface Work {
  id: string;
  title: string;
  type: string | null;
  disambiguation: string;
  relations?: Relation[];
}

export interface ArtistSearchResponse {
  created: string;
  count: number;
  offset: number;
  artists: Artist[];
}

export interface ReleaseGroupBrowseResponse {
  'release-group-count': number;
  'release-group-offset': number;
  'release-groups': ReleaseGroup[];
}

export interface ReleaseBrowseResponse {
  'release-count': number;
  'release-offset': number;
  releases: Release[];
}

export type ArtistInc =
  | 'recordings'
  | 'releases'
  | 'release-groups'
  | 'works'
  | 'aliases'
  | 'tags'
  | 'genres'
  | 'ratings'
  | 'annotation'
  | 'artist-rels'
  | 'url-rels'
  | 'recording-rels'
  | 'release-rels'
  | 'release-group-rels'
  | 'work-rels'
  | 'label-rels';

export type ReleaseGroupInc =
  | 'artists'
  | 'releases'
  | 'artist-credits'
  | 'aliases'
  | 'tags'
  | 'genres'
  | 'annotation'
  | 'artist-rels'
  | 'url-rels'
  | 'release-rels';

export type ReleaseInc =
  | 'artists'
  | 'labels'
  | 'recordings'
  | 'release-groups'
  | 'media'
  | 'artist-credits'
  | 'discids'
  | 'isrcs'
  | 'aliases'
  | 'tags'
  | 'genres'
  | 'annotation'
  | 'artist-rels'
  | 'label-rels'
  | 'recording-rels'
  | 'release-group-rels'
  | 'url-rels'
  | 'work-rels'
  | 'recording-level-rels'
  | 'work-level-rels';

export type RecordingInc =
  | 'artists'
  | 'releases'
  | 'release-groups'
  | 'isrcs'
  | 'artist-credits'
  | 'aliases'
  | 'tags'
  | 'genres'
  | 'annotation'
  | 'artist-rels'
  | 'url-rels'
  | 'work-rels'
  | 'release-rels';

/** Release-group `type` filter for browse requests: primary types, secondary types, or combinations joined with `|`. */
export type ReleaseGroupTypeFilter = string;
