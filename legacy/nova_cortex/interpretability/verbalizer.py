"""Deterministic evidence-scoped telemetry; never invents labels for raw features."""


class Verbalizer:
    def __init__(
        self, catalog=None, representation=None, *, frozen_representation=False
    ):
        self.catalog, self.representation = catalog, representation
        self.frozen = frozen_representation

    def translate(self, tick, active, *, uncertainty, mode, action, dictionary_trained):
        records = []
        for feature, value in active:
            concept = (
                self.catalog.lookup(self.representation, feature)
                if self.catalog is not None
                and self.representation
                and self.frozen
                and dictionary_trained
                else None
            )
            if concept is not None and value >= concept.activation_threshold:
                records.append(
                    dict(
                        feature_id=feature,
                        activation=value,
                        label=concept.label,
                        status=concept.status,
                        evidence=concept.evidence,
                    )
                )
            else:
                records.append(
                    dict(
                        feature_id=feature,
                        activation=value,
                        label=None,
                        status="unlabeled",
                    )
                )
        named = [r["label"] for r in records if r["label"]]
        description = (
            "; ".join(named[:6])
            if named
            else f"{len(records)} features esparsas sem rótulo validado"
        )
        text = f"[Tick {tick}] [{mode}] {description}. Dispersão do ensemble: {uncertainty:.6f}. Ação: {action}."
        return dict(
            text=text,
            features=records,
            dictionary_trained=dictionary_trained,
            semantic_scope="probe associations only; no mind-reading or formal physical proof",
        )
