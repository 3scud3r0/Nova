"""Grounded user-facing verbalization; optional neural generations remain drafts."""

from dataclasses import dataclass, field
from nova.values import OutputPolicy, SIMULATION_LABEL


@dataclass
class Interlocutor:
    beliefs: dict = field(default_factory=dict)
    goals: list[str] = field(default_factory=list)
    estimated_valence: float = 0.0
    turns: int = 0

    def update(self, *, beliefs=None, goals=None, valence=0.0):
        self.beliefs.update(beliefs or {})
        self.goals = list(goals or self.goals)
        self.estimated_valence = max(-1.0, min(1.0, valence))
        self.turns += 1


class GroundedVerbalizer:
    def render(self, claims, identity_mode=False, consented=False, style=None):
        # Style only changes formatting; it cannot create additional factual content.
        answer = OutputPolicy.render_claims(
            claims, identity_mode=identity_mode, consented=consented
        )
        if style and style.get("compact"):
            answer = answer.replace("\n", " ")
        return answer

    def stream(self, *args, interrupted=None, **kwargs):
        answer = self.render(*args, **kwargs)
        # Keep the permanent identity label intact as the first streaming chunk.
        if answer.startswith(SIMULATION_LABEL):
            yield SIMULATION_LABEL + "\n"
            answer = answer[len(SIMULATION_LABEL) :].lstrip()
        for word in answer.split():
            if interrupted is not None and interrupted():
                break
            yield word + " "


@dataclass(frozen=True)
class UnverifiedDraft:
    text: str
    source_ids: tuple[str, ...]
    requires_review: bool = True


class LocalLanguageAdapter:
    """Optional frozen local LLM with learned latent-prefix input (not auto-published).

    Requires separately installed transformers and local model weights. Generated
    text is an unverified draft; the grounded renderer remains the output gate.
    """

    def __init__(self, model_directory, latent_dim=8):
        import torch
        from transformers import AutoTokenizer, AutoModelForCausalLM

        self.tokenizer = AutoTokenizer.from_pretrained(
            model_directory, local_files_only=True
        )
        self.model = (
            AutoModelForCausalLM.from_pretrained(model_directory, local_files_only=True)
            .eval()
            .requires_grad_(False)
        )
        self.prefix = torch.nn.Linear(
            latent_dim, self.model.get_input_embeddings().embedding_dim
        )

    def draft(self, latent, claims, style=None, max_new_tokens=80):
        import json
        import torch

        prompt = json.dumps(
            {
                "facts": claims,
                "style": style or {},
                "instruction": "Verbalize only supplied facts and keep sources.",
            },
            ensure_ascii=False,
        )
        tokens = self.tokenizer(prompt, return_tensors="pt")
        with torch.no_grad():
            embeddings = self.model.get_input_embeddings()(tokens["input_ids"])
            prefix = self.prefix(torch.as_tensor(latent, dtype=embeddings.dtype))[
                None, None
            ]
            generated = self.model.generate(
                inputs_embeds=torch.cat((prefix, embeddings), 1),
                max_new_tokens=max_new_tokens,
                do_sample=False,
            )
        return UnverifiedDraft(
            self.tokenizer.decode(generated[0], skip_special_tokens=True),
            tuple(c["source"] for c in claims),
        )
