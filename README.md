<div align="center">

# NanniSCII

### The Tablet Talks Back · Inference and the Human Archive

*Tessa Edwards · Oct 2026*

<img src="images/artworks/worshipper.png" width="440" alt="A standing Sumerian worshipper statue redrawn entirely in cuneiform signs">

<sub>12,800 signs, 109 different ones, from 40 complaints translated into Akkadian. <a href="images/artworks/worshipper.pdf">Full-size vector PDF</a> · <a href="images/artworks/worshipper_detail.png">close-up</a></sub>

</div>

This project only skims the surface of a deeply complex, perhaps ineffable subject: the relationship between language, consciousness and machine inference, and its impact on society.

Around 1750 BC, an aggrieved man called Nanni pressed a complaint into clay. The copper ingots he'd been sold were poor quality, his messenger had been insulted and sent away empty-handed, and in his exasperation and he expressed his dissatisfaction in writing. His tablet, now in the British Museum, is considered to be the oldest customer complaint in the history of human language.

The subject tablet is used as the project anchor and root. The project has three parts:

The first part of the project is an essay about the representation of the human psyche through the evolution of language and the ‘living’ digital archive we are building. I establish that machines are now capable of mapping the latent representations of ‘human cognition’ across the whole human corpora. They are able to navigate the intricate topologies of the evolution of language and sentiment documented and digitised throughout the ages on multiple planes. As we are witnessing the paradigm shift from machine as ‘tool’ to machine as ‘operator’ (agent), machines have an elevated vantage point that humans are simply unable to access. Perhaps it’s an access point to a clearer picture of human consciousness itself, something we know relatively little about, yet the ramifications of which are beyond our comprehension. The essay explores how human expression becomes computational representation, and how representation can in turn become a mechanism of influence.

The second part of the project is an ascii art generator script that translates excerpts from a modern data base, (the archive of the US Consumer Financial Protection Bureau) into an image representation of ancient Akkadian cuneiform, returning the script to the symbols from which it first emerged. The tablet artefact in this respect, is used a vessel of social reflexivity through the process of transmutation; Context, meaning, and form into a digital artefact. A symbolic medium to make light of the weighty implications of training models on the vast human database of language and thought.

The third is a digital mnemonic; a Akkadian cuneiform particle decay overlay that subtly subverts pixels on the screen into an animation.  It's an ergonomic trinket from the past gently reminding us to stay aware of passive interchange with online interaction and the living digital archive. It is also very hypnotic. 


| Part | |
|---|---|
| **i · [The Tablet Talks Back](essay/the-tablet-talks-back.md)**<br>*Essay* | How human expression becomes computational representation, and how representation can in turn become a mechanism of influence. Machines can now map the latent representations of human cognition across the whole archive we've built, a vantage point no human can reach. [Read it](essay/the-tablet-talks-back.md) · [Artist statement](essay/artist-statement.md) · [Designed PDF](essay/The_Tablet_Talks_Back.pdf) |
| **ii · [The NanniSCII Generator](generator/)**<br>*ASCII art generator* | Translates excerpts from a modern database into an image drawn in ancient Akkadian cuneiform. The tablet as a vessel of social reflexivity: context, meaning and form transmuted into a digital artefact. [How to use it](generator/#make-an-image) |
| **iii · [Cuneiform Drift](extension/)**<br>*Browser extension* | A digital mnemonic. A cuneiform particle overlay that now and then melts the text you're reading into a digital clay sign, then reforms. A trinket from the past, reminding us of our passive exchange with the living digital archive, whilst we navigate online. [Install it](extension/#install-about-2-minutes) |

---

## How it works

![The NanniSCII pipeline](images/diagrams/pipeline.svg)

Every XXXX redaction survives as a break in the clay. Each line keeps a log of its Akkadian, its signs, and a back-translation.

| They wrote | The time machine translation |
|---|---|
| Today, my checking is negative, my savings is empty, and I was charged an overdraft fee. | On this day, I am ill, my silver is stolen, and my head is cut off. |
| On XX/XX/XXXX I went to get gas for my car. | I have come to the bed of my chariot. |
| I told them I don't have the full balance.. | I said to them: "There is nothing." |
| BofA has, in offense to the MOVE YOUR MONEY movement, done this to countless customers and should pay heavy penalties. | Bafâ has performed an extispicy on the possessions of your property without the consent of the king, and he should set out on a large campaign against them. |

*Four of the forty lines in the finished work. All of them are in [the data](data/reference.md).*

More in [the generator](generator/), [the data](data/) and [the research notes](research/).

<details>
<summary><b>The tablet unfolded</b>: the same six stages as the six faces of a tablet</summary>
<br>
<img src="images/diagrams/tablet_unfolded.png" width="600" alt="Tablet unfolding schematic: six faces A to F, consumer complaint to cuneiform ASCII">
</details>

## Quick start

**Try the extension.** [Download the zip](extension/cuneiform-drift.zip?raw=1), unzip it, open `chrome://extensions`, turn on *Developer mode*, click *Load unpacked*, and choose the folder. [Full instructions](extension/).

**Make an image.**

```bash
git clone https://github.com/dead-tom/NanniSCII.git
cd NanniSCII
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 generator/nanniscii_render.py "generator/images/Standing_male_worshiper_high_contrast.jpg"
```

This draws the worshipper with the translated lines in `data/translations.csv`. Swap in your own photo; to translate new complaints, see [the generator](generator/).

## Project Contents

```
essay/        the essay, the artist statement, the designed PDF
generator/    the scripts and the Colab notebook, from archive to image
extension/    Cuneiform Drift, the browser extension
data/         the lines used, with their translations
research/     the process: tests, results, decisions
images/       artworks, diagrams, process pictures
```

## Credits

- **Nanni's tablet:** UET V 81, British Museum 131236. English translation by A. Leo Oppenheim, *Letters from Mesopotamia* (1967).
- **Complaints:** US Consumer Financial Protection Bureau, Consumer Complaint Database, narratives archive (Export 2).
- **Translation:** [`praeclarum/cuneiform`](https://huggingface.co/praeclarum/cuneiform), a Sumerian and Akkadian translation model by praeclarum (MIT licence), run through [CuneiScribe](https://pypi.org/project/cuneiscribe/) 0.2.0.
- **Matching:** after Xu, Zhang and Wong, *Structure-based ASCII Art*, SIGGRAPH 2010.
- **Source photograph:** *Standing male worshipper*, Tell Asmar, c. 2900–2600 BC. The Metropolitan Museum of Art, 40.156, Fletcher Fund 1940; public-domain image.
- **Fonts:** [Noto Sans Cuneiform](https://fonts.google.com/noto/specimen/Noto+Sans+Cuneiform) and [Turret Road](https://fonts.google.com/specimen/Turret+Road), both SIL Open Font License.
- ** Coding collaboration and project supportt:** Claude 5.5 opus. 

## Licence

Code (generator, extension, research scripts): [MIT](LICENSE). Writing and images: [CC BY-NC 4.0](LICENSE-CONTENT), share with credit, not for commercial use. Fonts: SIL Open Font License. The complaint lines are from a US government archive.
