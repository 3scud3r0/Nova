"""Sense -> infer -> learn -> explain -> act -> replay, with bounded state.

The simulator is controlled by lockstep binary IPC. No external models, arbitrary
proof source or network endpoints are executed by this runtime.
"""

import asyncio
from collections import deque
import json
import time
from pathlib import Path
import numpy as np
import torch
from ..config import CortexConfig
from ..sensory.visual_retina import VisualRetina
from ..sensory.proprioception import Proprioception
from ..core.rssm_world_model import RSSMWorldModel, Belief
from ..core.active_inference import ActiveInference
from ..core.continuous_jepa import ContinuousJEPA
from ..memory.hippocampus_buffer import HippocampusBuffer, Transition
from ..memory.sleep_consolidator import SleepConsolidator
from ..memory.episodic_store import EpisodicStore
from ..executive.actor_critic import ActorCritic
from ..executive.prefrontal_planner import PrefrontalPlanner, action_to_wire
from ..executive.homeostatic_drive import HomeostaticDrive
from ..interpretability.sparse_autoencoder import SparseAutoencoder
from ..interpretability.verbalizer import Verbalizer
from ..interpretability.monosemantic_catalog import MonosemanticCatalog
from .ipc_bridge import IPCBridge
from .explained_dataset import ExplainedDataset
from . import checkpoints


class BrainLoop:
    def __init__(
        self,
        config,
        ring,
        output,
        *,
        checkpoint=None,
        sae_checkpoint=None,
        frozen_world=False,
        catalog=None,
        memory_directory=None,
    ):
        self.config = c = config.validate()
        torch.manual_seed(c.seed)
        self.rng = np.random.default_rng(c.seed)
        self.device = torch.device(c.device)
        self.frozen = frozen_world
        self.bridge = IPCBridge(ring, timeout=3600)
        self.retina = VisualRetina(c.channels, c.embedding, c.max_voxels).to(
            self.device
        )
        self.model = RSSMWorldModel(c).to(self.device)
        self.jepa = ContinuousJEPA(c.embedding, c.action_dim).to(self.device)
        self.actor = ActorCritic(c.latent, c.action_dim).to(self.device)
        self.sae = SparseAutoencoder(
            c.latent, c.dictionary, mode=c.sae_mode, top_k=c.top_k, l1=c.l1
        ).to(self.device)
        self.retina.requires_grad_(c.train_retina and not frozen_world)
        saved_normalizer = None
        if checkpoint:
            saved = checkpoints.load(checkpoint)
            source = CortexConfig(**saved["config"]).validate()
            for key in (
                "channels",
                "embedding",
                "hidden",
                "stochastic",
                "action_dim",
                "proprio_dim",
                "ensemble",
            ):
                if getattr(source, key) != getattr(c, key):
                    raise ValueError(f"checkpoint architecture differs: {key}")
            self.retina.load_state_dict(saved["retina"])
            self.model.load_state_dict(saved["world"])
            self.actor.load_state_dict(saved["actor"])
            self.jepa.load_state_dict(saved["jepa"])
            saved_normalizer = saved.get("proprio")
        if frozen_world:
            self.model.requires_grad_(False)
            self.jepa.requires_grad_(False)
        self.proprio = Proprioception(c.proprio_dim)
        if saved_normalizer is not None:
            self.proprio.load_state_dict(saved_normalizer)
        self.representation = checkpoints.representation_fingerprint(
            self.retina, self.model, self.proprio
        )
        self.dictionary_trained = False
        self.dictionary_matches = False
        if sae_checkpoint:
            saved_sae = checkpoints.load(sae_checkpoint)
            if saved_sae["schema"] != "NOVA-SAE-v1":
                raise ValueError("expected an SAE checkpoint")
            if saved_sae.get("mode") != c.sae_mode or saved_sae.get("top_k") != c.top_k:
                raise ValueError("SAE activation configuration differs")
            self.sae.load_state_dict(saved_sae["sae"])
            self.dictionary_trained = bool(saved_sae.get("trained", False))
            self.dictionary_matches = (
                saved_sae.get("representation_sha256") == self.representation
            )
            if (
                frozen_world
                and saved_sae.get("representation_sha256")
                and not self.dictionary_matches
            ):
                raise ValueError("SAE belongs to another frozen representation")
        self.sae.requires_grad_(False)
        namespace = checkpoints.dictionary_namespace(self.representation, self.sae)
        self.catalog = MonosemanticCatalog(catalog) if catalog else None
        self.verbalizer = Verbalizer(
            self.catalog,
            namespace,
            frozen_representation=frozen_world and self.dictionary_matches,
        )
        self.objective = ActiveInference(c).to(self.device)
        self.planner = PrefrontalPlanner(self.model, self.objective, c)
        self.drive = HomeostaticDrive(c)
        self.buffer = HippocampusBuffer(
            c.replay_capacity,
            protected_fraction=c.protected_fraction,
            alpha=c.replay_alpha,
            seed=c.seed,
        )
        self.sleep = SleepConsolidator(c)
        self.store = None
        if memory_directory:
            memory_root = Path(memory_directory)
            memory_root.mkdir(parents=True, exist_ok=True)
            self.store = EpisodicStore(
                memory_root / "episodes.sqlite",
                c.replay_capacity,
                representation=self.representation,
            )
            for transition, surprise in self.store.records():
                self._validate_transition_shape(transition)
                self.buffer.add(transition, surprise)
        parameters = [
            p
            for module in (self.retina, self.model, self.jepa)
            for p in module.parameters()
            if p.requires_grad
        ]
        self.world_optimizer = (
            torch.optim.AdamW(parameters, lr=c.learning_rate) if parameters else None
        )
        self.actor_optimizer = torch.optim.Adam(
            self.actor.parameters(), lr=c.learning_rate
        )
        self.dataset = ExplainedDataset(
            output,
            c,
            metadata=dict(
                ring=str(Path(ring).resolve()),
                representation_sha256=self.representation,
                stationary_representation=frozen_world,
                dictionary_namespace=namespace,
                dictionary_trained=self.dictionary_trained,
            ),
        )
        self.output = Path(output)
        self.symbolic_worker = None
        self.symbolic_samples = deque(maxlen=c.symbolic_window)
        self.model_step = 0
        self.replay_updates = 0
        self.checkpoint(self.output / "initial.pt")

    def _symbolic_tick(self, index):
        if not self.config.symbolic_every:
            return
        if self.symbolic_worker is not None:
            result = self.symbolic_worker.poll()
            if result is not None:
                result["target"] = "ID-matched mean ax over the next action interval"
                result["latent_dimensions"] = list(
                    range(self.config.symbolic_dimensions)
                )
                with (self.output / "symbolic.jsonl").open("a") as out:
                    out.write(json.dumps(result, allow_nan=False) + "\n")
        if index % self.config.symbolic_every or len(self.symbolic_samples) < 16:
            return
        if self.symbolic_worker is None:
            from ..interpretability.symbolic_distiller import SymbolicDistiller

            self.symbolic_worker = SymbolicDistiller(
                seed=self.config.seed, iterations=self.config.symbolic_iterations
            )
        if self.symbolic_worker.future is None:
            x = np.stack([row[0] for row in self.symbolic_samples])
            y = np.asarray([row[1] for row in self.symbolic_samples])
            self.symbolic_worker.submit(x, y)

    def _tensor(self, value):
        return torch.as_tensor(value, dtype=torch.float32, device=self.device)

    def checkpoint(self, path):
        checkpoints.save(
            path,
            dict(
                schema="NOVA-CORTEX-v1",
                config=self.config.to_dict(),
                retina=self.retina.state_dict(),
                world=self.model.state_dict(),
                actor=self.actor.state_dict(),
                jepa=self.jepa.state_dict(),
                model_step=self.model_step,
                proprio=self.proprio.state_dict(),
                torch_rng=torch.get_rng_state(),
                representation_sha256=checkpoints.representation_fingerprint(
                    self.retina, self.model, self.proprio
                ),
            ),
        )

    def _validate_transition_shape(self, t):
        c = self.config
        expected = dict(
            embedding=c.embedding,
            next_embedding=c.embedding,
            proprio=c.proprio_dim,
            next_proprio=c.proprio_dim,
            previous_h=c.hidden,
            previous_z=c.stochastic,
            last_action=c.action_dim,
            action=c.action_dim,
            drive=2,
            next_drive=2,
        )
        if any(getattr(t, name).shape != (n,) for name, n in expected.items()):
            raise ValueError("replay record belongs to another architecture")

    def replay_update(self, records, indices=None, importance=None):
        if not records or self.frozen:
            return 0.0
        for t in records:
            self._validate_transition_shape(t)
        batch = lambda name: self._tensor(np.stack([getattr(t, name) for t in records]))
        e, p = batch("embedding"), batch("proprio")
        prior = Belief(batch("previous_h"), batch("previous_z"))
        step = self.model.observe(e, p, batch("last_action"), prior)
        world_loss, terms = self.model.loss(
            step,
            e,
            batch("drive"),
            importance=None if importance is None else self._tensor(importance),
        )
        imagined = self.model.imagine(step.belief, batch("action"))
        following = batch("next_embedding")
        prediction = (
            (self.model.decoder(imagined.vector()) - following).square().mean(-1)
        )
        if importance is not None:
            prediction = prediction * self._tensor(importance)
        loss = (
            world_loss
            + prediction.mean()
            + self.config.jepa_weight * self.jepa.loss(e, batch("action"), following)
        )
        self._world_update(loss)
        if indices is not None:
            self.buffer.update_priorities(indices, prediction.detach().cpu().numpy())
        self.replay_updates += 1
        return float(loss.detach())

    def _world_update(self, loss):
        if self.world_optimizer is None:
            return
        if not torch.isfinite(loss):
            raise FloatingPointError("nonfinite world-model objective")
        self.world_optimizer.zero_grad(set_to_none=True)
        loss.backward()
        parameters = [
            p for group in self.world_optimizer.param_groups for p in group["params"]
        ]
        torch.nn.utils.clip_grad_norm_(parameters, 10.0, error_if_nonfinite=True)
        self.world_optimizer.step()
        self.jepa.update_target()
        self.model_step += 1

    async def run(self, ticks=1024, *, console_every=32):
        if not 2 <= ticks <= 1_000_000 or console_every < 1:
            raise ValueError("brain requires 2..1,000,000 bounded observations")
        c = self.config
        belief = self.model.initial()
        last_action = torch.zeros(1, c.action_dim, device=self.device)
        previous = None
        sequence = 0
        complete = False
        telemetry = (self.output / "telemetry.jsonl").open("x")
        try:
            for index in range(ticks):
                start = time.perf_counter()
                frame = await asyncio.to_thread(
                    self.bridge.read_latest_frame, after=sequence
                )
                with frame:
                    sequence, native_tick = frame.sequence, frame.tick
                    # A writable owned input isolates Torch/autograd from the mmap lease.
                    # Direct immutable NumPy borrowing remains available via Frame.array().
                    field = frame.array(copy=True)
                    if field.shape[0] != c.channels:
                        raise ValueError(
                            "IPC channels differ from retina configuration"
                        )
                    kind = frame.manifest["environment"]["kind"]
                    energy_available = (
                        kind == "particle-vm"
                        or frame.manifest["environment"].get("neural") is not None
                    )
                    signals = self.drive.from_field(
                        field, energy_available=energy_available
                    )
                    observations = dict(
                        occupancy=signals.occupancy,
                        diversity=signals.diversity,
                        energy=signals.energy,
                        kind=kind,
                        physical_tick=native_tick,
                    )
                    raw_proprio = np.zeros(c.proprio_dim)
                    available = np.zeros(c.proprio_dim, bool)
                    raw_proprio[:3] = (
                        last_action[0, :3].detach().cpu().numpy() + 1
                    ) * 0.5
                    raw_proprio[3] = float(last_action[0, 4])
                    raw_proprio[4:6] = [signals.occupancy, signals.diversity]
                    available[:6] = True
                    if signals.energy is not None:
                        raw_proprio[6], available[6] = signals.energy, True
                    raw_proprio[7], available[7] = time.perf_counter() - start, True
                    proprio = self.proprio.encode(
                        raw_proprio, available, update=not self.frozen
                    )
                    particles = frame.particles(copy=True)
                    particle_ids = frame.particle_ids(copy=True)
                    if len(particle_ids) != len(np.unique(particle_ids)):
                        raise ValueError("duplicate native particle IDs")
                    if (
                        previous is not None
                        and len(particles)
                        and len(previous["particle_ids"])
                    ):
                        _, before, after = np.intersect1d(
                            previous["particle_ids"],
                            particle_ids,
                            assume_unique=True,
                            return_indices=True,
                        )
                        elapsed = (native_tick - previous["tick"]) * frame.manifest[
                            "time_step"
                        ]
                        if len(before) and elapsed > 0:
                            acceleration = (
                                particles[after, 3:6]
                                - previous["particle_velocities"][before]
                            ) / elapsed
                            for axis, name in enumerate(
                                ("mean_ax", "mean_ay", "mean_az")
                            ):
                                observations[name] = float(acceleration[:, axis].mean())
                            observations["matched_particle_accelerations"] = len(before)
                    particle_tensor = (
                        self._tensor(particles).unsqueeze(0) if len(particles) else None
                    )
                    e = self.retina(self._tensor(field).unsqueeze(0), particle_tensor)
                    prior_belief = belief.detach()
                    state_model_step = self.model_step
                    step = self.model.observe(
                        e, self._tensor(proprio).unsqueeze(0), last_action, prior_belief
                    )
                    drive_target = self.drive.targets(signals)
                    loss, terms = self.model.loss(
                        step, e, self._tensor(drive_target).unsqueeze(0)
                    )
                    if previous is not None:
                        imagined = self.model.imagine(
                            previous["belief"], previous["action_tensor"]
                        )
                        loss = loss + torch.nn.functional.mse_loss(
                            self.model.decoder(imagined.vector()), e.detach()
                        )
                        loss = loss + c.jepa_weight * self.jepa.loss(
                            previous["embedding_tensor"],
                            previous["action_tensor"],
                            e.detach(),
                        )
                    if not self.frozen:
                        self._world_update(loss)
                    belief = step.belief.detach()
                    latent = belief.vector()
                    uncertainty = float(step.epistemic_proxy.detach().mean())
                    signals = type(signals)(
                        signals.occupancy,
                        signals.diversity,
                        signals.energy,
                        uncertainty,
                    )
                    reward = self.drive.reward(signals)
                    embedding = e.detach().cpu().numpy()[0].copy()
                    if previous is not None:
                        transition = Transition(
                            previous["embedding"],
                            previous["proprio"],
                            previous["prior_h"],
                            previous["prior_z"],
                            previous["last_action"],
                            previous["action"],
                            embedding,
                            proprio.copy(),
                            previous["drive"],
                            drive_target,
                            reward,
                            terminal=False,
                            truncated=index == ticks - 1,
                        )
                        surprise = float(terms["reconstruction"] + terms["kl"])
                        self.buffer.add(transition, surprise)
                        if self.store:
                            self.store.append(transition, surprise)
                        if not self.frozen:
                            actor_loss = self.actor.loss(
                                previous["belief"].vector(),
                                previous["action_tensor"],
                                self._tensor([reward]),
                                latent,
                                self._tensor([0.0]),
                                teacher=previous["action_tensor"]
                                if previous["teacher"]
                                else None,
                            )
                            self.actor_optimizer.zero_grad(set_to_none=True)
                            actor_loss.backward()
                            torch.nn.utils.clip_grad_norm_(
                                self.actor.parameters(), 10, error_if_nonfinite=True
                            )
                            self.actor_optimizer.step()
                        self.dataset.record(
                            dict(
                                episode_id=0,
                                tick=previous["tick"],
                                next_tick=native_tick,
                                model_step=previous["model_step"],
                                observation=previous["embedding"],
                                next_observation=embedding,
                                action=previous["action"],
                                reward=reward,
                                terminal=False,
                                truncated=index == ticks - 1,
                                latent=previous["latent"],
                                active_feature_ids=previous["ids"],
                                active_feature_values=previous["values"],
                                explanation=previous["explanation"]["text"],
                                evidence=previous["explanation"],
                                observables=previous["observables"],
                                next_observables=observations,
                            )
                        )
                    if previous is not None and "mean_ax" in observations:
                        self.symbolic_samples.append(
                            (
                                previous["latent"][: c.symbolic_dimensions].copy(),
                                observations["mean_ax"],
                            )
                        )
                    self._symbolic_tick(index)
                    final = index == ticks - 1
                    teacher = (
                        uncertainty > c.uncertainty_threshold
                        or index % c.plan_every == 0
                    )
                    action_model_step = self.model_step
                    with torch.no_grad():
                        if teacher and not final:
                            action, planner_report = self.planner.plan(
                                belief, self.actor
                            )
                        else:
                            action, planner_report = self.actor.act(latent), {}
                        features = self.sae.encode(latent)[0]
                        active = features.nonzero().flatten()
                        ids = active.cpu().tolist()
                        values = features[active].cpu().tolist()
                    wire = action_to_wire(action)
                    wire["type"] = "paint"
                    if kind in {
                        "particle-life",
                        "particle-vm",
                        "fusion",
                        "hunar",
                        "realethersim",
                        "primordial-dish",
                        "par-particle-life",
                        "cellflow",
                        "mpm",
                        "navier-stokes",
                    }:
                        wire["type"] = "impulse"
                        wire["vector"] = [v * wire["strength"] for v in wire["vector"]]
                    description = self.verbalizer.translate(
                        native_tick,
                        list(zip(ids, values))[:256],
                        uncertainty=uncertainty,
                        mode="deliberativo" if teacher else "reflexo",
                        action={"type": "session-close"} if final else wire,
                        dictionary_trained=self.dictionary_trained,
                    )
                    description["model_versions"] = {
                        "latent_step": state_model_step,
                        "action_step": action_model_step,
                    }
                    sleep_report = None
                    if not self.frozen and self.sleep.needs_consolidation(
                        index, float(loss.detach())
                    ):
                        sleep_report = self.sleep.run(
                            self.buffer, self.replay_update, model=self.model
                        )
                    record = dict(
                        tick=native_tick,
                        sequence=sequence,
                        world_loss=float(loss.detach()),
                        epistemic_proxy=uncertainty,
                        aleatoric_variance=float(
                            step.aleatoric_variance.mean().detach()
                        ),
                        active_features=len(ids),
                        replay_entries=len(self.buffer),
                        model_step=self.model_step,
                        planner=planner_report,
                        sleep=sleep_report,
                        explanation=description,
                        action_applied=not final,
                        proprio_available=available.tolist(),
                    )
                    telemetry.write(json.dumps(record, allow_nan=False) + "\n")
                    telemetry.flush()
                    if index % console_every == 0:
                        print(description["text"], flush=True)
                    previous = dict(
                        particle_ids=particle_ids,
                        particle_velocities=particles[:, 3:6].copy(),
                        embedding=embedding,
                        proprio=proprio.copy(),
                        drive=drive_target,
                        embedding_tensor=e.detach(),
                        belief=belief,
                        prior_h=prior_belief.h.cpu().numpy()[0].copy(),
                        prior_z=prior_belief.z.cpu().numpy()[0].copy(),
                        last_action=last_action.cpu().numpy()[0].copy(),
                        action=action.detach().cpu().numpy()[0].copy(),
                        action_tensor=action.detach(),
                        teacher=teacher,
                        latent=latent.cpu().numpy()[0].copy(),
                        ids=ids,
                        values=values,
                        explanation=description,
                        observables=observations,
                        tick=native_tick,
                        model_step=state_model_step,
                    )
                    last_action = action.detach()
                # The raw field lease is released before the simulator can advance.
                self.bridge.send_action(sequence, wire, close=final)
                if final:
                    complete = True
                    break
            self.checkpoint(self.output / "final.pt")
            return dict(
                observations=ticks,
                transitions=ticks - 1,
                model_steps=self.model_step,
                replay_updates=self.replay_updates,
                status="complete",
            )
        finally:
            if sequence > self.bridge.last_sent:
                try:
                    self.bridge.send_action(sequence, close=True)
                except (OSError, ValueError):
                    pass
            telemetry.close()
            self.dataset.close(complete=complete)
            if self.catalog:
                self.catalog.close()
            if self.store:
                self.store.close()
            if self.symbolic_worker:
                # Wait for the owned finite-budget worker on shutdown; the live
                # tick loop uses poll and never waits for a Julia fit.
                self.symbolic_worker.close()
                result = self.symbolic_worker.poll()
                if result is not None:
                    with (self.output / "symbolic.jsonl").open("a") as out:
                        out.write(json.dumps(result, allow_nan=False) + "\n")
