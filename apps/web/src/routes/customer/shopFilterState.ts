import type { ItemSort } from '@pataka/shared';

export type ShopFilterState = {
  q: string;
  cat: string;
  sort: ItemSort | '';
  kiloOnly: boolean;
  standardOnly: boolean;
};

export const NO_FILTERS: ShopFilterState = {
  q: '',
  cat: '',
  sort: '',
  kiloOnly: false,
  standardOnly: false,
};
