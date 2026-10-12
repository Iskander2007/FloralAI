"use client";

import { FormEvent, useEffect, useState } from "react";
import { ImagePlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CatalogProduct } from "@/lib/catalog";
import { translateError } from "@/lib/i18n";

const bucket = "product-images";
const maximumImageSize = 5 * 1024 * 1024;
const allowedImageTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
]);

type ProductDraft = {
    name: string;
    price: string;
    description: string;
    image: File | null;
};

const emptyDraft: ProductDraft = {
    name: "",
    price: "",
    description: "",
    image: null,
};

function imageUrl(path: string | null) {
    if (!path) return null;
    const supabase = createSupabaseBrowserClient();
    return supabase?.storage.from(bucket).getPublicUrl(path).data.publicUrl ?? null;
}

export function ProductCatalog() {
    const { locale, t } = useLanguage();
    const [products, setProducts] = useState<CatalogProduct[]>([]);
    const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
    const [editing, setEditing] = useState<CatalogProduct | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    useEffect(() => {
        let cancelled = false;
        async function loadProducts() {
            const supabase = createSupabaseBrowserClient();
            if (!supabase) {
                setError(t("Catalog storage is not configured."));
                setLoading(false);
                return;
            }
            try {
                const { data: userData, error: userError } =
                    await supabase.auth.getUser();
                if (userError) throw userError;
                if (!userData.user) {
                    throw new Error(t("Sign in to manage your catalog."));
                }
                const { data, error: queryError } = await supabase
                    .from("catalog_products")
                    .select("id, name, price_kzt, description, image_path, created_at")
                    .eq("owner_id", userData.user.id)
                    .order("created_at", { ascending: false });
                if (queryError) throw queryError;
                if (!cancelled) setProducts((data ?? []) as CatalogProduct[]);
            } catch (loadError) {
                if (!cancelled) {
                    setError(
                        translateError(locale, loadError, "Could not load your product catalog."),
                    );
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void loadProducts();
        return () => {
            cancelled = true;
        };
    }, [locale, t]);

    function resetForm() {
        setDraft(emptyDraft);
        setEditing(null);
        setFormOpen(false);
        setError("");
    }

    function editProduct(product: CatalogProduct) {
        setEditing(product);
        setFormOpen(true);
        setDraft({
            name: product.name,
            price: String(product.price_kzt),
            description: product.description,
            image: null,
        });
        setError("");
        setNotice("");
    }

    async function saveProduct(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setNotice("");
        const supabase = createSupabaseBrowserClient();
        if (!supabase) {
            setError(t("Catalog storage is not configured."));
            return;
        }

        const name = draft.name.trim();
        const price = Number(draft.price);
        const description = draft.description.trim();
        if (!name || name.length > 120 || !Number.isSafeInteger(price) || price < 0) {
            setError(t("Enter a product name and a whole-number price of 0 or more."));
            return;
        }
        if (description.length > 1000) {
            setError(t("Description must be 1,000 characters or fewer."));
            return;
        }
        if (draft.image && !allowedImageTypes.has(draft.image.type)) {
            setError(t("Choose a JPG, PNG, WebP or GIF image."));
            return;
        }
        if (draft.image && draft.image.size > maximumImageSize) {
            setError(t("Images must be 5 MB or smaller."));
            return;
        }

        setSaving(true);
        let newImagePath: string | null = null;
        try {
            const { data: userData, error: userError } =
                await supabase.auth.getUser();
            if (userError) throw userError;
            if (!userData.user) {
                throw new Error(t("Sign in to manage your catalog."));
            }

            if (draft.image) {
                const extension =
                    draft.image.type === "image/jpeg"
                        ? "jpg"
                        : draft.image.type.split("/")[1];
                newImagePath = `${userData.user.id}/${crypto.randomUUID()}.${extension}`;
                const { error: uploadError } = await supabase.storage
                    .from(bucket)
                    .upload(newImagePath, draft.image, {
                        contentType: draft.image.type,
                        upsert: false,
                    });
                if (uploadError) throw uploadError;
            }

            const imagePath = newImagePath ?? editing?.image_path ?? null;
            const values = {
                name,
                price_kzt: price,
                description,
                image_path: imagePath,
            };
            let savedProduct: CatalogProduct;
            if (editing) {
                const { data, error: updateError } = await supabase
                    .from("catalog_products")
                    .update(values)
                    .eq("id", editing.id)
                    .eq("owner_id", userData.user.id)
                    .select("id, name, price_kzt, description, image_path, created_at")
                    .single();
                if (updateError) throw updateError;
                savedProduct = data as CatalogProduct;
            } else {
                const { data, error: insertError } = await supabase
                    .from("catalog_products")
                    .insert({ ...values, owner_id: userData.user.id })
                    .select("id, name, price_kzt, description, image_path, created_at")
                    .single();
                if (insertError) throw insertError;
                savedProduct = data as CatalogProduct;
            }

            setProducts((current) =>
                editing
                    ? current.map((product) =>
                          product.id === savedProduct.id ? savedProduct : product,
                      )
                    : [savedProduct, ...current],
            );
            setNotice(t(editing ? "Product updated." : "Product added."));
            const oldImagePath = editing?.image_path;
            resetForm();
            if (newImagePath && oldImagePath) {
                const { error: removeError } = await supabase.storage
                    .from(bucket)
                    .remove([oldImagePath]);
                if (removeError) {
                    setError(
                        t("Product saved, but its previous image could not be removed."),
                    );
                }
            }
        } catch (saveError) {
            if (newImagePath) {
                const { error: cleanupError } = await supabase.storage
                    .from(bucket)
                    .remove([newImagePath]);
                if (cleanupError) {
                    console.error("Unable to remove an unused product image.", cleanupError);
                }
            }
            setError(
                translateError(locale, saveError, "Could not save the product."),
            );
        } finally {
            setSaving(false);
        }
    }

    async function deleteProduct(product: CatalogProduct) {
        if (!window.confirm(t("Delete this product?"))) return;
        const supabase = createSupabaseBrowserClient();
        if (!supabase) {
            setError(t("Catalog storage is not configured."));
            return;
        }
        setError("");
        setNotice("");
        setSaving(true);
        try {
            const { data: userData, error: userError } =
                await supabase.auth.getUser();
            if (userError) throw userError;
            if (!userData.user) {
                throw new Error(t("Sign in to manage your catalog."));
            }
            const { error: deleteError } = await supabase
                .from("catalog_products")
                .delete()
                .eq("id", product.id)
                .eq("owner_id", userData.user.id);
            if (deleteError) throw deleteError;
            setProducts((current) =>
                current.filter((item) => item.id !== product.id),
            );
            setNotice(t("Product deleted."));
            if (product.image_path) {
                const { error: removeError } = await supabase.storage
                    .from(bucket)
                    .remove([product.image_path]);
                if (removeError) {
                    setError(
                        t("Product deleted, but its image could not be removed."),
                    );
                }
            }
        } catch (deleteError) {
            setError(
                translateError(locale, deleteError, "Could not delete the product."),
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <section className="product-catalog">
            <div className="dashboard-page-heading">
                <div>
                    <div className="eyebrow">{t("YOUR PRODUCTS")}</div>
                    <h1>{t("Product catalog")}</h1>
                    <p>
                        {t("Add photos, prices and descriptions so your assistant can answer product questions.")}
                    </p>
                </div>
                {!editing && products.length > 0 && (
                    <button
                        type="button"
                        className="button button-blue"
                        onClick={() => {
                            setFormOpen(true);
                            setDraft(emptyDraft);
                            setEditing(null);
                            setError("");
                            setNotice("");
                        }}
                    >
                        <Plus size={15} /> {t("Add product")}
                    </button>
                )}
            </div>

            {(error || notice) && (
                <p
                    className={error ? "auth-error" : "auth-notice"}
                    role={error ? "alert" : "status"}
                >
                    {error || notice}
                </p>
            )}

            {(formOpen || (!loading && products.length === 0)) && (
                <form className="dashboard-panel product-form" onSubmit={saveProduct}>
                    <div className="panel-heading">
                        <div>
                            <h2>{t(editing ? "Edit product" : "New product")}</h2>
                            <p>{t("Product details are visible only to your signed-in account.")}</p>
                        </div>
                        {(editing || products.length > 0) && (
                            <button
                                type="button"
                                className="quiet-button"
                                onClick={resetForm}
                                aria-label={t("Cancel")}
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>
                    <div className="product-form-grid">
                        <label>
                            {t("Product name")}
                            <input
                                required
                                maxLength={120}
                                value={draft.name}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        name: event.target.value,
                                    }))
                                }
                                placeholder={t("For example, Rose bouquet")}
                            />
                        </label>
                        <label>
                            {t("Price (KZT)")}
                            <input
                                required
                                type="number"
                                min="0"
                                step="1"
                                value={draft.price}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        price: event.target.value,
                                    }))
                                }
                                placeholder="15000"
                            />
                        </label>
                        <label className="product-description-field">
                            {t("Description")}
                            <textarea
                                maxLength={1000}
                                rows={3}
                                value={draft.description}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        description: event.target.value,
                                    }))
                                }
                                placeholder={t("Flower types, size, packaging or delivery details")}
                            />
                        </label>
                        <label className="product-image-field">
                            {t("Product photo")} <small>{t("Up to 5 MB · JPG, PNG, WebP or GIF")}</small>
                            <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        image: event.target.files?.[0] ?? null,
                                    }))
                                }
                            />
                            {editing?.image_path && !draft.image && (
                                <span>{t("Current photo will be kept unless you choose another.")}</span>
                            )}
                        </label>
                    </div>
                    <div className="product-form-actions">
                        <button
                            type="submit"
                            className="button button-blue"
                            disabled={saving}
                        >
                            {saving ? t("Saving...") : t(editing ? "Save changes" : "Save product")}
                        </button>
                        {editing && (
                            <button
                                type="button"
                                className="button button-outline"
                                onClick={resetForm}
                                disabled={saving}
                            >
                                {t("Cancel")}
                            </button>
                        )}
                    </div>
                </form>
            )}

            {loading ? (
                <div className="dashboard-panel product-empty">{t("Loading products...")}</div>
            ) : products.length === 0 ? (
                <div className="dashboard-panel product-empty">
                    <ImagePlus size={24} />
                    <h2>{t("Your catalog is empty")}</h2>
                    <p>{t("Add your first product to teach your assistant about your flowers and prices.")}</p>
                </div>
            ) : (
                <div className="product-grid">
                    {products.map((product) => {
                        const photo = imageUrl(product.image_path);
                        return (
                            <article className="dashboard-panel product-card" key={product.id}>
                                {photo ? (
                                    // Product images are intentionally public so customers can view catalog items.
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={photo} alt={product.name} />
                                ) : (
                                    <div className="product-card-placeholder">
                                        <ImagePlus size={22} />
                                    </div>
                                )}
                                <div className="product-card-content">
                                    <div className="product-card-title">
                                        <h2>{product.name}</h2>
                                        <b>{new Intl.NumberFormat(undefined).format(product.price_kzt)} ₸</b>
                                    </div>
                                    {product.description && <p>{product.description}</p>}
                                    <div className="product-card-actions">
                                        <button
                                            type="button"
                                            className="quiet-button"
                                            onClick={() => editProduct(product)}
                                            disabled={saving}
                                        >
                                            <Pencil size={14} /> {t("Edit")}
                                        </button>
                                        <button
                                            type="button"
                                            className="quiet-button product-delete"
                                            onClick={() => void deleteProduct(product)}
                                            disabled={saving}
                                        >
                                            <Trash2 size={14} /> {t("Delete")}
                                        </button>
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
