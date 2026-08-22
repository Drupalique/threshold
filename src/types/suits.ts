export type SuitCategory = 'threat' | 'boon' | 'guard';

export type SuitId = 'wolf' | 'ember' | 'rot' | 'spider' | 'grace' | 'ward';

export interface SuitDef {
  id: SuitId;
  name: string;
  category: SuitCategory;
  displayColor: string;
}
