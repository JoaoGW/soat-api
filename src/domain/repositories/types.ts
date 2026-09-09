export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface ActiveFilter extends PaginationParams {
  ativo?: boolean;
}
