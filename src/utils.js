import { bech32 } from 'bech32';

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const convertToValoper = (accAddress, valPrefix) => {
  try {
    if (!accAddress) return null;
    const decoded = bech32.decode(accAddress);
    return bech32.encode(valPrefix, decoded.words);
  } catch (e) {
    return null;
  }
};

export const normalizeVoteOption = (optionRaw) => {
  const VOTE_MAP = {
    0: 'UNSPECIFIED',
    1: 'YES',
    2: 'ABSTAIN',
    3: 'NO',
    4: 'NO_WITH_VETO'
  };

  if (typeof optionRaw === 'number' || (typeof optionRaw === 'string' && /^\d+$/.test(optionRaw))) {
    return VOTE_MAP[parseInt(optionRaw)] || 'UNKNOWN';
  }

  if (typeof optionRaw === 'string') {
    return optionRaw.replace('VOTE_OPTION_', '');
  }

  return 'UNKNOWN';
};