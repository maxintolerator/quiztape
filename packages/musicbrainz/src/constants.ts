/**
 * MusicBrainz identifiers and vocabulary the engine relies on. Every UUID here
 * was verified against https://musicbrainz.org/relationships/* and the
 * special-purpose-artist style page on 2026-09-19. Match relationships by
 * `type-id`, never by the human-readable `type` string, which can be renamed.
 */

export const MUSICBRAINZ_API_URL = 'https://musicbrainz.org/ws/2/';
export const COVER_ART_ARCHIVE_URL = 'https://coverartarchive.org/';

/** Maximum page size for browse and search. */
export const MB_MAX_LIMIT = 100;

/** Relationship type names as MusicBrainz spells them in `relations[].type`. */
export const ARTIST_RELATION = {
  MEMBER_OF_BAND: 'member of band',
  SUBGROUP: 'subgroup',
  COLLABORATION: 'collaboration',
  SUPPORTING_MUSICIAN: 'supporting musician',
  FOUNDER: 'founder',
  IS_PERSON: 'is person',
  ARTIST_RENAME: 'artist rename',
  TRIBUTE: 'tribute',
} as const;

/**
 * Artist–artist relationship type ids. Direction is relative to the looked-up
 * artist: `member of band` has person = entity0, group = entity1, so on a Group
 * lookup members appear as `backward`, on a Person lookup groups as `forward`.
 * `subgroup` is stored inconsistently in the data; treat it as undirected.
 */
export const ARTIST_RELATION_TYPE_ID = {
  MEMBER_OF_BAND: '5be4c609-9afa-4ea0-910b-12ffb71e3821',
  SUBGROUP: '7802f96b-d995-4ce9-8f70-6366faad758e',
  ARTIST_RENAME: '9752bfdf-13ca-441a-a8bc-18928c600c73',
  FOUNDER: '6ed4bfc4-0a0d-44c0-b025-b7fc4d900b67',
  SUPPORTING_MUSICIAN: '88562a60-2550-48f0-8e8e-f54d95c7369a',
  VOCAL_SUPPORTING_MUSICIAN: '610d39a4-3fa0-4848-a8c9-f46d7b5cc02e',
  INSTRUMENTAL_SUPPORTING_MUSICIAN: 'ed6a7891-ce70-4e08-9839-1f2f62270497',
  COLLABORATION: '75c09861-6857-4ec0-9729-84eefde7fc86',
  IS_PERSON: 'dd9886f2-1dfe-4270-97db-283f6839a666',
  TRIBUTE: 'a6f62641-2f58-470e-b02b-88d7b984dc9f',
  VOICE_ACTOR: 'e259a3f5-ce8e-45c1-9ef7-90ff7d0c7589',
  TEACHER: '249fc24f-d573-4290-9d74-0547712d1f1e',
  ARTISTIC_DIRECTOR: 'ab666dde-bd85-4ac2-a209-165eaf4146a0',
  CONDUCTOR_POSITION: 'cac01ac7-4159-42fd-9f2b-c5a7a5624079',
  PARENT: '9421ca84-934f-49fe-9e66-dea242430406',
  SIBLING: 'b42b7966-b904-449e-b8f9-8c7297b863d0',
  MARRIED: 'b2bf7a5d-2da6-4742-baf4-e38d8a7ad029',
  INVOLVED_WITH: 'fd3927ba-fd51-4fa9-bcc2-e83637896fe8',
  NAMED_AFTER_ARTIST: '1af24726-5b1f-4b07-826e-5351723f504b',
} as const;

/** Attributes that appear on 'member of band' relations. 'founder' is a separate relationship type, not an attribute. */
export const MEMBER_ATTRIBUTE = {
  ORIGINAL: 'original',
  ADDITIONAL: 'additional',
  EPONYMOUS: 'eponymous',
  PRINCIPAL: 'principal',
} as const;

/** Artist–recording relationship type ids (artist = entity0, so `backward` on a recording). Producer credits live here. */
export const RECORDING_RELATION_TYPE_ID = {
  PRODUCER: '5c0ceac3-feb4-41f0-868d-dc06f6e27fc0',
  ENGINEER: '5dcc52af-7064-4051-8d62-7d80f4c3c907',
  MIX: '3e3102e1-1896-4f50-b5b2-dd9824e46efe',
  RECORDING_ENGINEER: 'a01ee869-80a8-45ef-9447-c59e91aa7926',
  PROGRAMMING: '36c50022-44e0-488d-994b-33f11d20301e',
  REMIXER: '7950be4d-13a3-48e7-906b-5af562e39544',
  ARRANGER: '22661fb8-cdb7-4f67-8385-b2a8be6c9f0d',
  PERFORMER: '628a9658-f54c-4142-b0c0-95f031b544da',
  CONDUCTOR: '234670ce-5f22-4fd0-921b-ef1662695c5d',
  PHONOGRAPHIC_COPYRIGHT: '7fd5fbc0-fbf4-4d04-be23-417d50a4dc30',
} as const;

/** Artist–release relationship type ids. Release-level producer credits are often empty; prefer recording-level. */
export const RELEASE_RELATION_TYPE_ID = {
  PRODUCER: '8bf377ba-8d71-4ecc-97f2-7bb2d8a2a75f',
  ENGINEER: '87e922ba-872e-418a-9f41-0a63aa3c30cc',
  MIX: '6cc958c0-533b-4540-a281-058fbb941890',
  MASTERING: '84453d28-c3e8-4864-9aae-25aa968bcf9e',
} as const;

/** URL relationship type ids that carry a Wikidata link (`url.resource` = https://www.wikidata.org/wiki/Q…). Recordings have none. */
export const URL_RELATION_TYPE_ID = {
  ARTIST_WIKIDATA: '689870a4-a1e4-4912-b17f-7b2664215698',
  RELEASE_GROUP_WIKIDATA: 'b988d08c-5d86-4a57-9557-c83b399e3580',
  WORK_WIKIDATA: '587fdd8f-080e-46a9-97af-6425ebbcb3a2',
  LABEL_WIKIDATA: '75d87e83-d927-4580-ba63-44dc76256f98',
} as const;

export const RELEASE_STATUS_ID = {
  OFFICIAL: '4e304316-386d-3409-af2e-78857eec5cfe',
} as const;

/** The "Various Artists" special-purpose artist; never browse its release groups and never treat it as a band. */
export const VARIOUS_ARTISTS_MBID = '89ad4ac3-39f7-470e-963a-56509c546377';

/** Special-purpose artists that must be excluded from trivia (verified against the MusicBrainz style guide). */
export const SPECIAL_PURPOSE_ARTIST_MBIDS: ReadonlySet<string> = new Set([
  VARIOUS_ARTISTS_MBID,
  '125ec42a-7229-4250-afc5-e057484327fe', // [unknown]
  'f731ccc4-e22a-43af-a747-64213329e088', // [anonymous]
  'eec63d3c-3b81-4ad4-b1e4-7c147d4d2b61', // [no artist]
  '9be7f096-97ec-4615-8957-8d40b5dcbc41', // [traditional]
  '33cf029c-63b0-41a0-9855-be2a3665fb3b', // [data]
  '314e1c25-dde7-4e4d-b2f4-0a7b9f7c56dc', // [dialogue]
  '7e84f845-ac16-41fe-9ff8-df12eb32af55', // MusicBrainz Test Artist
]);
