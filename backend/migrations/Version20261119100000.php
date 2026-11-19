<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use App\Entity\AttributeType;
use App\Migration\AttributeMigration;
use Doctrine\DBAL\Schema\Schema;

/**
 * The system attributes (with key) used to come from data/attributes.yaml; now they live in migrations only.
 * Creates each one that is missing, so an empty database gets them and one that has them (production, local copies) stays as it is.
 * Attributes without a key (Holzart, Polternummer …) belong to V29 and are not created here.
 */
final class Version20261119100000 extends AttributeMigration
{
    public function getDescription(): string
    {
        return 'Create the system attributes that are missing';
    }

    public function up(Schema $schema): void
    {
        $both = ['stem', 'beam'];

        // Diameters belong to the stem alone: a beam has none, so they are not inherited.
        $this->addMissing(key: 'mid_diameter_max', name: 'Stammmittendurchmesser groß', type: AttributeType::Number, appliesTo: ['stem'], inheritable: false, unit: 'cm');
        $this->addMissing(key: 'mid_diameter_min', name: 'Stammmittendurchmesser klein', type: AttributeType::Number, appliesTo: ['stem'], inheritable: false, unit: 'cm');
        // Same value for a stem and the beams sawn lengthwise from it; set the beam's own value after a cross cut.
        $this->addMissing(key: 'length', name: 'Länge', type: AttributeType::Choice, appliesTo: $both, inheritable: true, options: ['4,10 m', '3,60 m', '3,20 m']);
        // Stems only, therefore not inheritable: a stem with beams is sawable by definition.
        $unsawableAdded = $this->addMissing(
            key: 'unsawable', name: 'Nicht sägbar', type: AttributeType::Boolean, appliesTo: ['stem'], inheritable: false,
            description: 'Stamm lässt sich nicht zu Balken sägen, Grund in die Notiz.',
        );
        $sawnAdded = $this->addMissing(key: 'sawn', name: 'Gesägt', type: AttributeType::Boolean, appliesTo: ['stem'], inheritable: true);
        // The two exclude each other; like everything here, only on an attribute this migration created.
        if ($unsawableAdded) {
            $this->setHiddenWhen('unsawable', ['sawn']);
        }
        if ($sawnAdded) {
            $this->setHiddenWhen('sawn', ['unsawable']);
        }
        // Recorded on each beam: the cross-section is a property of the sawn beam, not of the stem.
        $this->addMissing(key: 'sawn_cross_section', name: 'Gesägter Querschnitt', type: AttributeType::Choice, appliesTo: ['beam'], inheritable: false, options: ['14,7 x 14,7 cm', '10,5 x 14,7 cm']);
        $this->addMissing(key: 'notes', name: 'Notiz', type: AttributeType::Text, appliesTo: $both, inheritable: false, series: true);
        $this->addMissing(key: 'photos', name: 'Fotos', type: AttributeType::Photo, appliesTo: $both, inheritable: false, series: true);
    }

    public function down(Schema $schema): void
    {
        $this->throwIrreversibleMigrationException();
    }

    /**
     * @param list<string> $appliesTo
     * @param list<string> $options
     *
     * @return bool whether it was missing and is created now
     */
    private function addMissing(string $key, string $name, AttributeType $type, array $appliesTo, bool $inheritable, bool $series = false, array $options = [], ?string $unit = null, string $description = ''): bool
    {
        if ($this->hasAttribute($key)) {
            return false;
        }
        $this->addAttribute($key, $name, $type, $appliesTo, $inheritable, $series, $options, $unit, $description);

        return true;
    }
}
