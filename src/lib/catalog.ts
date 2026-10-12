export type CatalogProduct = {
    id: string;
    name: string;
    price_kzt: number;
    description: string;
    image_path: string | null;
    created_at: string;
};

export type AssistantProduct = Pick<
    CatalogProduct,
    "name" | "price_kzt" | "description"
>;
